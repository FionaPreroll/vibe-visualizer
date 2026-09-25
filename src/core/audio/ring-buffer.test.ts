import { describe, expect, it } from 'vitest';
import {
  AudioRingConsumer,
  AudioRingMonitor,
  AudioRingProducer,
  createAudioRing,
} from './ring-buffer';

const RATE = 48000;

function ramp(start: number, length: number): Float32Array {
  return Float32Array.from({ length }, (_, i) => start + i);
}

function setup(capacity = 8, channels = 2) {
  const sab = createAudioRing(channels, capacity);
  return {
    sab,
    producer: new AudioRingProducer(sab, channels),
    consumer: new AudioRingConsumer(sab, channels),
    monitor: new AudioRingMonitor(sab, channels),
    out: Array.from({ length: channels }, () => new Float32Array(4)),
  };
}

describe('audio ring buffer', () => {
  it('rounds the capacity up to a power of two', () => {
    expect(new AudioRingMonitor(createAudioRing(2, 100), 2).capacity).toBe(128);
  });

  it('passes frames through in order across the wrap-around', () => {
    const { producer, consumer, out } = setup();
    let next = 0;
    for (let round = 0; round < 10; round++) {
      expect(producer.write([ramp(next, 6), ramp(1000 + next, 6)], 0, 6)).toBe(6);
      for (let i = 0; i < 6; i += 3) {
        expect(consumer.read(out, 3, 0, RATE)).toBe(3);
        expect(Array.from(out[0]!.subarray(0, 3))).toEqual([next, next + 1, next + 2]);
        expect(Array.from(out[1]!.subarray(0, 3))).toEqual([1000 + next, 1001 + next, 1002 + next]);
        next += 3;
      }
    }
  });

  it('only writes as much as fits', () => {
    const { producer } = setup(8);
    expect(producer.write([ramp(0, 20)], 0, 20)).toBe(8);
    expect(producer.freeFrames).toBe(0);
  });

  it('stays continuous when the uint32 frame counters wrap', () => {
    const { sab, producer, consumer, out } = setup(8, 1);
    const control = new Int32Array(sab, 0, 8);
    control[0] = -3; // write counter = 2^32 - 3
    control[1] = -3; // read counter
    producer.write([ramp(0, 6)], 0, 6);
    consumer.read(out, 4, 0, RATE);
    expect(Array.from(out[0]!)).toEqual([0, 1, 2, 3]);
    consumer.read(out, 2, 0, RATE);
    expect(Array.from(out[0]!.subarray(0, 2))).toEqual([4, 5]);
  });

  it('duplicates a mono source to all channels', () => {
    const { producer, consumer, out } = setup();
    producer.write([ramp(5, 4)], 0, 4);
    consumer.read(out, 4, 0, RATE);
    expect(Array.from(out[1]!)).toEqual([5, 6, 7, 8]);
  });

  it('drops old frames when a new generation starts', () => {
    const { producer, consumer, monitor, out } = setup();
    producer.write([ramp(0, 8)], 0, 8);
    const generation = producer.beginGeneration(48000);
    expect(producer.isAcknowledged(generation)).toBe(false);

    // The consumer switches over and outputs silence until new frames arrive.
    expect(consumer.read(out, 4, 1.0, RATE)).toBe(0);
    expect(producer.isAcknowledged(generation)).toBe(true);
    expect(monitor.bufferedFrames).toBe(0);
    expect(monitor.firstFrameTime(generation)).toBeNull();

    producer.write([ramp(100, 4)], 0, 4);
    expect(consumer.read(out, 4, 2.0, RATE)).toBe(4);
    expect(Array.from(out[0]!)).toEqual([100, 101, 102, 103]);
    expect(monitor.firstFrameTime(generation)).toBe(2.0);
    expect(monitor.position).toBe(48004);
    expect(monitor.renderTime).toBeCloseTo(2.0 + 4 / RATE);
  });

  it('counts underruns only while a generation is playing and not ended', () => {
    const { producer, consumer, monitor, out } = setup();
    const generation = producer.beginGeneration(0);
    consumer.read(out, 4, 0, RATE); // acknowledge; nothing buffered yet: startup, no underrun
    expect(monitor.underruns).toBe(0);

    producer.write([ramp(0, 6)], 0, 6);
    consumer.read(out, 4, 0, RATE);
    consumer.read(out, 4, 0, RATE); // only 2 frames left → underrun
    expect(monitor.underruns).toBe(1);

    producer.markEnded(generation);
    consumer.read(out, 4, 0, RATE); // end of stream → no underrun
    expect(monitor.underruns).toBe(1);
    expect(monitor.isEnded()).toBe(true);
  });
});
