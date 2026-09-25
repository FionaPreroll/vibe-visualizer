import { describe, expect, it } from 'vitest';
import { hashFloat32 } from '../../util/hash';
import { RatePlayer } from '../rate-player';
import { createTestSignal } from '../test-signal';
import { SignalsmithStretch } from './signalsmith-stretch';

const RATE = 48000;

function renderAll(player: RatePlayer, blockFrames: number, totalFrames: number): Float32Array[] {
  const out = [new Float32Array(totalFrames), new Float32Array(totalFrames)];
  const block = [new Float32Array(blockFrames), new Float32Array(blockFrames)];
  for (let done = 0; done < totalFrames; done += blockFrames) {
    const frames = Math.min(blockFrames, totalFrames - done);
    player.render(block, frames);
    out[0]!.set(block[0]!.subarray(0, frames), done);
    out[1]!.set(block[1]!.subarray(0, frames), done);
  }
  return out;
}

describe('Signalsmith Stretch binding', () => {
  const input = createTestSignal(4, RATE);

  it('instantiates and reports its latency', () => {
    const stretch = new SignalsmithStretch(2, RATE);
    expect(stretch.inputLatency).toBeGreaterThan(0);
    expect(stretch.outputLatency).toBeGreaterThan(0);
  });

  it('produces non-silent output at 0.8x with key lock', () => {
    const player = new RatePlayer(input, new SignalsmithStretch(2, RATE));
    player.rate = 0.8;
    const out = renderAll(player, 128, RATE * 2);
    const energy = out[0]!.reduce((sum, x) => sum + x * x, 0) / out[0]!.length;
    expect(energy).toBeGreaterThan(0.001);
    expect(player.positionFrames).toBeCloseTo(RATE * 2 * 0.8, -1);
  });

  it('is deterministic: two instances give bit-identical output', () => {
    const run = () => {
      const player = new RatePlayer(input, new SignalsmithStretch(2, RATE));
      player.rate = 1.25;
      return hashFloat32(...renderAll(player, 128, RATE));
    };
    expect(run()).toBe(run());
  });

  it('vinyl mode at rate 1 reproduces the input', () => {
    const player = new RatePlayer(input, new SignalsmithStretch(2, RATE));
    player.mode = 'vinyl';
    const out = renderAll(player, 128, 1000);
    expect(Array.from(out[0]!.subarray(0, 1000))).toEqual(Array.from(input[0]!.subarray(0, 1000)));
  });
});
