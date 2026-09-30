import { describe, expect, it } from 'vitest';
import { SoftTakeover } from './takeover';

describe('SoftTakeover', () => {
  it('waits until a control reaches the value, then follows it', () => {
    const takeover = new SoftTakeover(0.03);
    // The app has 0.5; the fader stands at 0.9 and moves down.
    expect(takeover.accept('volume', 0.9, 0.5)).toBe(false);
    expect(takeover.accept('volume', 0.7, 0.5)).toBe(false);
    // It passes the value: from here on it sets it.
    expect(takeover.accept('volume', 0.45, 0.5)).toBe(true);
    expect(takeover.accept('volume', 0.2, 0.45)).toBe(true);
    expect(takeover.accept('volume', 0.8, 0.2)).toBe(true);
  });

  it('takes a control over at once when it is close to the value', () => {
    const takeover = new SoftTakeover(0.03);
    expect(takeover.accept('filter', 0.51, 0.5)).toBe(true);
  });

  it('lets go when the value was changed by other means', () => {
    const takeover = new SoftTakeover(0.03);
    expect(takeover.accept('tempo', 0.5, 0.5)).toBe(true);
    // The value changes on screen: the control has to reach it again.
    expect(takeover.accept('tempo', 0.52, 0.8)).toBe(false);
    expect(takeover.accept('tempo', 0.81, 0.8)).toBe(true);
    takeover.reset();
    expect(takeover.accept('tempo', 0.1, 0.8)).toBe(false);
  });
});
