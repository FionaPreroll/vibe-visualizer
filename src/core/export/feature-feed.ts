import {
  createFeatureTimeline,
  FeatureTimelineReader,
  FeatureTimelineWriter,
} from '../analysis/feature-timeline';
import { F } from '../analysis/features';
import { analysisFrameTime, FEATURE_FIELDS, type ExportTiming } from './export-job';

/** Reads `count` stored analysis frames from `index` on (FEATURE_FIELDS floats each). */
export type RecordSource = (index: number, count: number) => Promise<Float32Array<ArrayBufferLike>>;

const CHUNK_RECORDS = 4096;

/**
 * Feeds the stored analysis of an export into a feature timeline, just ahead of the frame being
 * rendered. The video pass then samples it with the same code as the live view.
 */
export class FeatureFeed {
  readonly reader: FeatureTimelineReader;
  private readonly writer: FeatureTimelineWriter;
  private readonly frame = new Float32Array(F.size);
  private next = 0;
  private chunk: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private chunkStart = 0;

  constructor(
    private readonly source: RecordSource,
    private readonly timing: ExportTiming,
  ) {
    const timeline = createFeatureTimeline(1024);
    this.writer = new FeatureTimelineWriter(timeline);
    this.reader = new FeatureTimelineReader(timeline);
  }

  /** Feeds from a little before engine frame `frame` on (when resuming mid-export). */
  seek(frame: number): void {
    const index = Math.floor((frame - this.timing.analysisStart) / this.timing.hop) - 2;
    this.next = Math.max(0, index);
  }

  /** Adds every analysis frame up to one hop after engine frame `frame` (for interpolation). */
  async ensure(frame: number): Promise<void> {
    const { timing } = this;
    while (
      this.next < timing.analysisFrames &&
      analysisFrameTime(timing, this.next) <= frame + timing.hop
    ) {
      this.frame.set(await this.record(this.next));
      this.writer.write(analysisFrameTime(timing, this.next), 0, this.frame);
      this.next++;
    }
  }

  private async record(index: number): Promise<Float32Array> {
    const loaded = this.chunk.length / FEATURE_FIELDS;
    if (index < this.chunkStart || index >= this.chunkStart + loaded) {
      const count = Math.min(CHUNK_RECORDS, this.timing.analysisFrames - index);
      this.chunk = await this.source(index, count);
      this.chunkStart = index;
      if (this.chunk.length < FEATURE_FIELDS) throw new Error('The stored analysis is incomplete');
    }
    const offset = (index - this.chunkStart) * FEATURE_FIELDS;
    return this.chunk.subarray(offset, offset + FEATURE_FIELDS);
  }
}
