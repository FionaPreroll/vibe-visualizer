import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { exposeWorker, withTransfer } from '../util/worker-rpc';

/** Reads what the queue shows about a file, without decoding the audio. */

export type ProbeResult =
  | {
      status: 'ready';
      title: string | null;
      artist: string | null;
      album: string | null;
      duration: number;
      sampleRate: number;
      channels: number;
      codec: string;
      format: string;
      cover: { data: ArrayBuffer; mimeType: string } | null;
    }
  | { status: 'unsupported'; reason: string };

async function probe(args: { file: File }) {
  const input = new Input({ source: new BlobSource(args.file), formats: ALL_FORMATS });
  try {
    if (!(await input.canRead())) return { status: 'unsupported', reason: 'unknown file format' };
    const track = await input.getPrimaryAudioTrack();
    if (!track) return { status: 'unsupported', reason: 'no audio track' };
    if (!(await track.canDecode())) {
      return { status: 'unsupported', reason: `cannot decode ${track.codec ?? 'this codec'}` };
    }
    const duration = (await input.getDurationFromMetadata()) ?? (await input.computeDuration());
    const tags = await input.getMetadataTags().catch(() => null);
    const image =
      tags?.images?.find((candidate) => candidate.kind === 'coverFront') ?? tags?.images?.[0];
    const cover = image
      ? { data: image.data.slice().buffer as ArrayBuffer, mimeType: image.mimeType }
      : null;
    const result: ProbeResult = {
      status: 'ready',
      title: tags?.title ?? null,
      artist: tags?.artist ?? null,
      album: tags?.album ?? null,
      duration,
      sampleRate: track.sampleRate,
      channels: track.numberOfChannels,
      codec: track.codec ?? 'unknown',
      format: (await input.getFormat()).name,
      cover,
    };
    return cover ? withTransfer(result, [cover.data]) : result;
  } catch (error) {
    return {
      status: 'unsupported',
      reason: error instanceof Error ? error.message : String(error),
    } satisfies ProbeResult;
  } finally {
    input.dispose();
  }
}

exposeWorker({ probe });
