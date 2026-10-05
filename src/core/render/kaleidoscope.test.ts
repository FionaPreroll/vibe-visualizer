import { describe, expect, it } from 'vitest';
import { DEFAULT_KALEIDO } from './kaleido-settings';
import { KaleidoscopeScene, nextHue, nextReach, stateSquare, viewReach } from './kaleidoscope';

/** A texture, framebuffer or other object that the recording context hands out. */
interface Handle {
  id: number;
  /** A framebuffer's texture, which it draws into. */
  texture?: Handle;
}

/** A draw call: the texture it draws into (null: the canvas), and those on units 0, 1 and 2. */
interface Draw {
  into: Handle | null;
  units: (Handle | null)[];
}

/**
 * A WebGL2 context without a GPU: it keeps track of the textures each draw reads and writes, and
 * of textures bound after they were deleted. Everything else does nothing.
 */
function recordingContext() {
  const constants: Record<string, number> = {
    TEXTURE0: 0x84c0,
    ACTIVE_UNIFORMS: 0x8b86,
    FRAMEBUFFER_COMPLETE: 0x8cd5,
  };
  let next = 1;
  let unit = 0;
  const units: (Handle | null)[] = [];
  let framebuffer: Handle | null = null;
  const deleted = new Set<Handle>();
  const draws: Draw[] = [];
  const errors: string[] = [];
  const calls: Record<string, (...args: never[]) => unknown> = {
    activeTexture: (value: number) => {
      unit = value - constants['TEXTURE0']!;
    },
    bindTexture: (_target: number, texture: Handle | null) => {
      if (texture && deleted.has(texture)) errors.push(`texture ${texture.id} used once deleted`);
      units[unit] = texture;
    },
    deleteTexture: (texture: Handle) => deleted.add(texture),
    bindFramebuffer: (_target: number, buffer: Handle | null) => {
      framebuffer = buffer;
    },
    framebufferTexture2D: (_target: number, _point: number, _kind: number, texture: Handle) => {
      framebuffer!.texture = texture;
    },
    drawArrays: () => draws.push({ into: framebuffer?.texture ?? null, units: units.slice(0, 3) }),
    getShaderParameter: () => true,
    getProgramParameter: (_program: Handle, name: number) =>
      name === constants['ACTIVE_UNIFORMS'] ? 0 : true,
    checkFramebufferStatus: () => constants['FRAMEBUFFER_COMPLETE'],
    getParameter: () => 4096,
    getExtension: () => ({}),
    isContextLost: () => false,
  };
  const gl = new Proxy(calls, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (name in target) return target[name];
      if (/^[A-Z0-9_]+$/.test(name)) return (constants[name] ??= 0x10000 + next++);
      if (name.startsWith('create')) return () => ({ id: next++ });
      return () => undefined;
    },
  }) as unknown as WebGL2RenderingContext;
  return { gl, draws, errors };
}

describe('the Kaleidoscope state', () => {
  it('holds the circle the corners of the frame turn on, at its pixel density', () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
      [2560, 1080],
    ] as const) {
      const { side, reach } = stateSquare(width, height);
      // The corner, in units of half the frame's height, lies inside the square.
      expect(reach).toBeGreaterThan(Math.hypot(width / height, 1));
      // A pixel of the state is a pixel of the frame: its height spans height / 2 per unit.
      expect(side / (2 * reach)).toBeCloseTo(height / 2, 0);
    }
    // Upright or across, the frame turns on the same circle.
    expect(stateSquare(1080, 1920).side).toBe(stateSquare(1920, 1080).side);
  });

  it('keeps to the largest side, covering the same circle with fewer pixels', () => {
    const uhd = stateSquare(3840, 2160);
    expect(uhd.side).toBe(4096);
    expect(uhd.reach).toBeCloseTo(stateSquare(1920, 1080).reach);
    expect(stateSquare(1920, 1080, 2048).side).toBe(2048);
  });

  it('reaches as far as the view looks: zoomed out or off centre (KA-05)', () => {
    const aspect = 16 / 9;
    const base = stateSquare(1920, 1080).reach;
    // Zoom 1 in the middle: the square as before.
    expect(viewReach(aspect, 1, 0, 0)).toBeCloseTo(base);
    // Zoomed out to half, the frame's corners show what lies twice as far out.
    expect(viewReach(aspect, 0.5, 0, 0)).toBeCloseTo(base * 2);
    // Moved off centre, the far corner is further away.
    expect(viewReach(aspect, 1, 0.4, 0)).toBeCloseTo(Math.hypot(aspect * 1.8, 1) * 1.05);
    expect(viewReach(aspect, 1, -0.4, 0.4)).toBeCloseTo(Math.hypot(aspect * 1.8, 1.8) * 1.05);
  });

  it('changes its reach in steps, growing at once and shrinking two steps late', () => {
    const base = 2;
    // Zoomed in: never less than in the middle at zoom 1, where the light comes from.
    expect(nextReach(base, 1, base)).toBe(base);
    // Zoomed out: the step that holds what the view needs.
    const half = nextReach(base, base * 2, base);
    expect(half).toBeCloseTo(base * 2);
    const between = nextReach(base, base * 1.5, base);
    expect(between).toBeGreaterThanOrEqual(base * 1.5);
    expect(between).toBeLessThan(base * 1.5 * 2 ** (1 / 8) + 1e-9);
    // One step less is kept, two steps less are let go.
    expect(nextReach(base, half / 2 ** (1 / 8), half)).toBe(half);
    expect(nextReach(base, half / 2 ** (2 / 8), half)).toBeCloseTo(half / 2 ** (2 / 8));
    expect(nextReach(base, base, half)).toBe(base);
  });

  it('takes its colours back when the hue cycle stops', () => {
    const turn = Math.PI * 2;
    // One turn a minute: a quarter turn in 15 s, and it wraps instead of growing.
    let hue = 0;
    for (let i = 0; i < 15 * 60; i++) hue = nextHue(hue, 1, 1 / 60);
    expect(hue).toBeCloseTo(turn / 4, 3);
    for (let i = 0; i < 60 * 60; i++) hue = nextHue(hue, 1, 1 / 60);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(turn);
    // At 0 it goes back to the look's own colours within a few seconds, the short way round.
    hue = turn * 0.9;
    const first = nextHue(hue, 0, 1 / 60);
    expect(first).toBeLessThan(0);
    expect(first).toBeGreaterThan(-turn * 0.1);
    for (let i = 0; i < 4 * 60; i++) hue = nextHue(hue, 0, 1 / 60);
    expect(hue).toBe(0);
  });
});

describe('the Kaleidoscope picture', () => {
  const features = new Float32Array(256);
  const zoomed = (zoom: number) => ({
    ...DEFAULT_KALEIDO,
    common: { ...DEFAULT_KALEIDO.common, zoom },
  });

  it('shows the two latest steps, the older first, also when the zoom redraws them (KA-05)', () => {
    const { gl, draws, errors } = recordingContext();
    const scene = new KaleidoscopeScene(gl);
    scene.setSettings(zoomed(1));
    scene.resize(640, 360);
    /** One frame of one step: returns the number of draws. */
    const frame = () => {
      draws.length = 0;
      const picture = scene.renderLayer({ time: 0, dt: 1 / 60, features });
      const [step, composite] = draws.slice(-2);
      expect(composite!.into).toBe(picture);
      // The latest is what the step drew, the previous what it drew from.
      expect(composite!.units[1]).toBe(step!.into);
      expect(composite!.units[0]).toBe(step!.units[0]);
      return draws.length;
    };
    for (let i = 0; i < 3; i++) expect(frame()).toBe(2);
    // Zoomed out, the state reaches further: both buffers are drawn anew, and the old ones go.
    scene.setSettings(zoomed(0.5));
    expect(frame()).toBe(4);
    expect(frame()).toBe(2);
    expect(errors).toEqual([]);
  });
});
