import type { TrackAnalyses } from '../core/library/track-analyzer';
import type { StreamFile } from '../core/player/player';
import type { OverlayTrack } from '../core/render/overlay-settings';
import type { Renderer } from '../core/render/renderer';
import { decodeImage } from '../core/render/visual-assets';
import { shownArtist, shownTitle, type Track } from '../core/state/app-state';

/** The overlay's view of `track` (LS-18): its names and the part that plays; null until known. */
export function overlayTrack(track: Track): OverlayTrack | null {
  if (track.duration === null) return null;
  return {
    title: shownTitle(track),
    artist: shownArtist(track),
    start: track.marks.in ?? 0,
    end: track.marks.out ?? track.duration,
  };
}

/**
 * Whether how loud `track` gets is still being found out (AN-05): its analysis has not run yet
 * or runs, without a loudness from before. Until then, the camera does not move with the music.
 */
export function stillCalm(track: Track, analyses: TrackAnalyses): boolean {
  if (!track.fingerprint) return true;
  const analysis = analyses.get(track.fingerprint);
  if (!analysis || analysis.loudness) return false;
  return analysis.status === 'waiting' || analysis.status === 'running';
}

/**
 * Keeps the render worker told about the files of the engine's stream (the one heard and the
 * one that follows): their tracks for the overlay, whether the camera stays calm for them, and
 * their cover art for the logo (LS-15), each cover decoded once.
 */
export class StreamInfo {
  private sent = '';
  private readonly covers = new Map<number, string | null>();

  constructor(private readonly renderer: Renderer) {}

  update(
    files: readonly StreamFile[],
    tracks: readonly Track[],
    rate: number,
    covers: boolean,
    analyses: TrackAnalyses,
  ): void {
    const entries = files.map(({ token, id }) => ({
      token,
      track: tracks.find((entry) => entry.id === id) ?? null,
    }));
    const overlay = entries.map(({ token, track }) => ({
      token,
      track: track ? overlayTrack(track) : null,
      calm: track ? stillCalm(track, analyses) : false,
    }));
    const key = JSON.stringify([overlay, rate]);
    if (key !== this.sent) {
      this.sent = key;
      this.renderer.setTracks(overlay, rate);
    }
    for (const token of [...this.covers.keys()]) {
      if (!files.some((file) => file.token === token)) this.covers.delete(token);
    }
    if (!covers) return;
    for (const { token, track } of entries) {
      const url = track?.coverUrl ?? null;
      if (this.covers.has(token) && this.covers.get(token) === url) continue;
      this.covers.set(token, url);
      if (!url) {
        this.renderer.setCover(token, null);
        continue;
      }
      fetch(url)
        .then((response) => response.blob())
        .then(decodeImage)
        .then(
          (bitmap) => {
            if (this.covers.get(token) === url) this.renderer.setCover(token, bitmap);
            else bitmap.close();
          },
          () => this.renderer.setCover(token, null),
        );
    }
  }
}
