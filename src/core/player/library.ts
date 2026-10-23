import type { QueueEntry } from '../library/folder-reader';
import type { ProbeResult } from '../library/probe.worker';
import { storedInfo, type Access, type StoredQueue } from '../library/queue-store';
import {
  newTrack,
  restoredTrack,
  type AppAction,
  type AppState,
  type Track,
  type TrackData,
} from '../state/app-state';
import type { Store } from '../state/store';
import { errorMessage } from '../util/format';

/** What the queue's files need of the browser; fakes in the tests. */
export interface LibraryServices {
  /** Reads the tags, the duration and the cover art of a file (in a worker). */
  probe(file: File): Promise<ProbeResult>;
  /** The queue of the last visit, or null. */
  loadQueue(): Promise<StoredQueue | null>;
  accessOf(handle: FileSystemFileHandle): Promise<Access>;
  requestAccess(handle: FileSystemFileHandle): Promise<boolean>;
  /** What is kept for the file of `fingerprint` (TR-05), or null. */
  loadTrackData(fingerprint: string, duration: number): TrackData | null;
  readCover(fingerprint: string): Promise<Blob | null>;
  writeCover(fingerprint: string, cover: Blob | null): Promise<void>;
  /** Asks the browser to keep the app's storage. */
  keepStorage(): Promise<unknown>;
}

/** The files of entries taken out of the queue: put back on undo, or let go. */
export interface TakenFiles {
  /** The tracks come back at `index`, with their files; `currentId` becomes current. */
  putBack(index: number, currentId: string | null): void;
  /** They are gone for good: their covers, and the analyses no other entry needs. */
  forget(): void;
}

/**
 * The files behind the queue (#55): the files and handles of its entries, added (SRC-01,
 * SRC-03) or brought back from the last visit (SRC-05), probed one after the other, the files of
 * a folder sorted by their track numbers; access asked for where the browser wants it; the
 * covers the user gave files (LS-21).
 */
export class Library {
  /** Resolves once the queue of the last visit is back (it is saved only after that). */
  readonly restored: Promise<void>;
  private readonly files = new Map<string, File>();
  /** Handles to the files, where the browser gives them: the queue keeps them (SRC-05). */
  private readonly handles = new Map<string, FileSystemFileHandle>();
  private probing: Promise<void> = Promise.resolve();
  /** The covers the user gave files (LS-21), by fingerprint: object URLs, null for none. */
  private readonly ownCovers = new Map<string, Promise<string | null>>();
  private unlocking: Promise<void> | null = null;

  constructor(
    private readonly store: Store<AppState, AppAction>,
    private readonly services: LibraryServices,
    /** Asks for the analysis of a probed file; `first` for the track playing. */
    private readonly analyse: (fingerprint: string, file: File, first: boolean) => void,
    /** Drops the analysis of a file no entry has any more. */
    private readonly forgetAnalysis: (fingerprint: string) => void,
  ) {
    this.restored = this.restore().catch((error: unknown) => {
      console.error('The queue of the last visit could not be restored', error);
    });
  }

  /** The file of entry `id`, while the browser gives it. */
  file(id: string): File | undefined {
    return this.files.get(id);
  }

  /**
   * Appends files to the queue (SRC-01, SRC-03). A file that an entry of the last visit misses
   * brings that entry back instead (SRC-05). The files of a folder are sorted by track number
   * once probed, where their tags have one.
   */
  add(entries: readonly QueueEntry[]): void {
    const tracks: Track[] = [];
    const ids: string[] = [];
    const folders = new Map<string, string[]>();
    for (const entry of entries) {
      const { file, handle } = entry;
      const waiting = this.state.tracks.find(
        (track) =>
          (track.status === 'missing' || track.status === 'locked') &&
          track.fileName === file.name &&
          track.size === file.size &&
          !this.files.has(track.id),
      );
      const id = waiting?.id ?? crypto.randomUUID();
      this.files.set(id, file);
      if (handle) this.handles.set(id, handle);
      if (waiting) this.dispatch({ type: 'tracks/access', id, status: 'probing' });
      else tracks.push(newTrack(id, file));
      ids.push(id);
      if (entry.folder === null) continue;
      const group = folders.get(entry.folder);
      if (group) group.push(id);
      else folders.set(entry.folder, [id]);
    }
    if (tracks.length > 0) this.dispatch({ type: 'tracks/added', tracks });
    const probes = new Map(ids.map((id) => [id, this.queueProbe(id)]));
    if (folders.size > 0) void this.arrange([...folders.values()], probes);
  }

  /**
   * Asks for access to the files of the last visit (SRC-05); call it from a click. The browser
   * may ask once for all of them; if the user declines, the rest stays locked.
   */
  unlock(): Promise<void> {
    this.unlocking ??= this.unlockAll().finally(() => (this.unlocking = null));
    return this.unlocking;
  }

  /**
   * Gives the file of track `id` a cover of the user's (LS-21), made by `prepareCover`, for
   * every entry of that file; it shows instead of the file's, in the queue, on the logo and in
   * exports, and is kept for the file. Null takes it away.
   */
  async setOwnCover(id: string, cover: Blob | null): Promise<void> {
    const fingerprint = this.state.tracks.find((track) => track.id === id)?.fingerprint;
    if (!fingerprint) return;
    const url = cover ? URL.createObjectURL(cover) : null;
    const previous = this.ownCovers.get(fingerprint);
    this.ownCovers.set(fingerprint, Promise.resolve(url));
    this.dispatch({ type: 'tracks/cover', fingerprint, url });
    void previous?.then((old) => old && URL.revokeObjectURL(old));
    if (cover) void this.services.keepStorage();
    await this.services.writeCover(fingerprint, cover);
  }

  /** The queue as it is stored (SRC-05): each entry with what is known of its file. */
  storedQueue(): StoredQueue {
    return {
      entries: this.state.tracks.map((track) => ({
        id: track.id,
        info: storedInfo(track),
        handle: this.handles.get(track.id) ?? null,
      })),
      currentId: this.state.currentId,
    };
  }

  /** Takes the files of `tracks` out, as they leave the queue: see {@link TakenFiles}. */
  take(tracks: readonly Track[]): TakenFiles {
    const kept = tracks.map((track) => ({
      id: track.id,
      file: this.files.get(track.id),
      handle: this.handles.get(track.id),
    }));
    for (const track of tracks) {
      this.files.delete(track.id);
      this.handles.delete(track.id);
    }
    return {
      putBack: (index, currentId) => {
        for (const { id, file, handle } of kept) {
          if (file) this.files.set(id, file);
          if (handle) this.handles.set(id, handle);
        }
        this.dispatch({ type: 'tracks/inserted', index, tracks: [...tracks], currentId });
        // A probe that was running when they went was dropped.
        for (const track of tracks) if (track.status === 'probing') void this.queueProbe(track.id);
      },
      forget: () => this.forget(tracks),
    };
  }

  private get state(): AppState {
    return this.store.state;
  }

  private dispatch(action: AppAction): void {
    this.store.dispatch(action);
  }

  /** Probes the entry after the ones before it; null when it was removed meanwhile. */
  private queueProbe(id: string): Promise<ProbeResult | null> {
    const result = this.probing.then(() => this.probe(id));
    this.probing = result.then(() => undefined);
    return result;
  }

  /**
   * Sorts the files of each folder by disc and track number, once they are probed, unless the
   * user has moved them meanwhile (SRC-03). A folder in which a file has no number stays sorted
   * by name.
   */
  private async arrange(
    folders: string[][],
    probes: Map<string, Promise<ProbeResult | null>>,
  ): Promise<void> {
    for (const ids of folders) {
      const results = await Promise.all(ids.map((id) => probes.get(id)));
      const found = ids.flatMap((id, index) => {
        const result = results[index];
        return result?.status === 'ready' ? [{ id, index, result }] : [];
      });
      if (found.length < 2 || found.some(({ result }) => result.trackNumber === null)) continue;
      const number = (result: ProbeResult & { status: 'ready' }) =>
        (result.discNumber ?? 1) * 10000 + result.trackNumber!;
      const sorted = [...found]
        .sort((a, b) => number(a.result) - number(b.result) || a.index - b.index)
        .map(({ id }) => id);
      const listed = new Set(sorted);
      const now = this.state.tracks
        .filter((track) => listed.has(track.id))
        .map((track) => track.id);
      const before = found.map(({ id }) => id).filter((id) => now.includes(id));
      const moved = now.join('\n') !== before.join('\n');
      if (!moved && sorted.some((id, index) => id !== before[index])) {
        this.dispatch({ type: 'tracks/arranged', ids: sorted });
      }
    }
  }

  private async probe(id: string): Promise<ProbeResult | null> {
    const file = this.files.get(id);
    if (!file) return null;
    const result = await this.services.probe(file).catch((error: unknown): ProbeResult => ({
      status: 'unsupported',
      reason: errorMessage(error),
    }));
    if (this.files.get(id) !== file) return null; // removed (or replaced) meanwhile
    if (result.status === 'unsupported') {
      this.dispatch({
        type: 'tracks/probed',
        id,
        info: {
          status: 'unsupported',
          reason: result.reason,
          title: null,
          artist: null,
          album: null,
          duration: null,
          sampleRate: null,
          codec: null,
          format: null,
          coverUrl: null,
          fingerprint: null,
        },
      });
      return result;
    }
    const coverUrl = result.cover
      ? URL.createObjectURL(new Blob([result.cover.data], { type: result.cover.mimeType }))
      : null;
    const stored = this.services.loadTrackData(result.fingerprint, result.duration);
    this.dispatch({
      type: 'tracks/probed',
      id,
      info: {
        status: 'ready',
        reason: null,
        title: result.title,
        artist: result.artist,
        album: result.album,
        duration: result.duration,
        sampleRate: result.sampleRate,
        codec: result.codec,
        format: result.format,
        coverUrl,
        fingerprint: result.fingerprint,
        ...(stored ? { stored } : {}),
      },
    });
    this.loadOwnCover(result.fingerprint);
    // Waveform and beat grid in the background; the track that plays first.
    this.analyse(result.fingerprint, file, id === this.state.currentId);
    return result;
  }

  /**
   * Shows the cover the user gave the file of `fingerprint` (LS-21), if there is one: read once,
   * one object URL for every entry of the file.
   */
  private loadOwnCover(fingerprint: string): void {
    let cover = this.ownCovers.get(fingerprint);
    if (!cover) {
      cover = this.services.readCover(fingerprint).then(
        (blob) => (blob ? URL.createObjectURL(blob) : null),
        () => null,
      );
      this.ownCovers.set(fingerprint, cover);
    }
    void cover.then((url) => {
      if (url && this.ownCovers.get(fingerprint) === cover) {
        this.dispatch({ type: 'tracks/cover', fingerprint, url });
      }
    });
  }

  /** Brings back the queue of the last visit (SRC-05), with the files the browser still gives. */
  private async restore(): Promise<void> {
    const stored = await this.services.loadQueue();
    if (!stored || stored.entries.length === 0) return;
    const tracks: Track[] = [];
    for (const { id, info, handle } of stored.entries) {
      const access = handle
        ? await this.services.accessOf(handle).catch((): Access => 'denied')
        : 'denied';
      const file = handle && access === 'granted' ? await handle.getFile().catch(() => null) : null;
      const status = file ? 'probing' : access === 'prompt' ? 'locked' : 'missing';
      if (file) this.files.set(id, file);
      if (handle && status !== 'missing') this.handles.set(id, handle);
      const data =
        info.fingerprint && info.duration !== null
          ? this.services.loadTrackData(info.fingerprint, info.duration)
          : null;
      tracks.push(restoredTrack(id, info, status, data));
    }
    this.dispatch({ type: 'tracks/restored', tracks, currentId: stored.currentId });
    // The user's covers show at once, also for files that need permission first.
    for (const track of tracks) if (track.fingerprint) this.loadOwnCover(track.fingerprint);
    for (const track of tracks) if (track.status === 'probing') void this.queueProbe(track.id);
  }

  private async unlockAll(): Promise<void> {
    for (const track of this.state.tracks.filter((entry) => entry.status === 'locked')) {
      const handle = this.handles.get(track.id);
      if (!handle || this.files.has(track.id)) continue;
      const access = await this.services.accessOf(handle).catch((): Access => 'denied');
      if (access === 'prompt' && !(await this.services.requestAccess(handle).catch(() => false))) {
        return;
      }
      const file = access === 'denied' ? null : await handle.getFile().catch(() => null);
      if (!this.state.tracks.some((entry) => entry.id === track.id)) continue; // removed
      if (!file) {
        this.handles.delete(track.id);
        this.dispatch({ type: 'tracks/access', id: track.id, status: 'missing' });
        continue;
      }
      this.files.set(track.id, file);
      this.dispatch({ type: 'tracks/access', id: track.id, status: 'probing' });
      void this.queueProbe(track.id);
    }
  }

  /**
   * Removed tracks are gone for good: their covers, and the analyses and own covers (shown, not
   * stored) that no entry needs any more.
   */
  private forget(tracks: readonly Track[]): void {
    for (const track of tracks) {
      if (track.coverUrl) URL.revokeObjectURL(track.coverUrl);
      const fingerprint = track.fingerprint;
      if (fingerprint && !this.state.tracks.some((entry) => entry.fingerprint === fingerprint)) {
        this.forgetAnalysis(fingerprint);
        const cover = this.ownCovers.get(fingerprint);
        this.ownCovers.delete(fingerprint);
        void cover?.then((url) => url && URL.revokeObjectURL(url));
      }
    }
  }
}
