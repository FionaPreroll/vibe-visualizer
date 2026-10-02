import {
  bindTarget,
  createTarget,
  deleteTarget,
  FRAGMENT_HEADER,
  FULLSCREEN_VERTEX,
  Program,
  readTarget,
  writeTarget,
  type Target,
} from './gl';
import type { SnapshotBuffer } from './scene';

/**
 * Post-processing shared by the scenes: bloom (threshold, downsample chain, tent upsampling)
 * and the final pass to the canvas with a soft highlight roll-off and dithering (VE-02).
 * Scenes render in sRGB space into a half-float target; values above 1 are highlights.
 *
 * Reduce flashing (VE-06): the picture is also reduced to a coarse grid, whose brightness has a
 * settled level that rises slowly and falls quickly. The brightness around each point may rise
 * only a little above its settled level, so sudden flashes are damped while slow changes pass.
 * It goes by the frames' times, so an export is calmed exactly as the preview.
 */

const DOWNSAMPLE = `${FRAGMENT_HEADER}
uniform sampler2D source;
uniform vec2 texel;
uniform float threshold;
void main() {
  vec3 c = texture(source, uv).rgb * 4.0;
  c += texture(source, uv + texel * vec2(-1.0, -1.0)).rgb;
  c += texture(source, uv + texel * vec2(1.0, -1.0)).rgb;
  c += texture(source, uv + texel * vec2(-1.0, 1.0)).rgb;
  c += texture(source, uv + texel * vec2(1.0, 1.0)).rgb;
  c /= 8.0;
  // Soft threshold: only the part above it glows.
  float brightness = max(c.r, max(c.g, c.b));
  float knee = smoothstep(threshold - 0.25, threshold + 0.25, brightness);
  color = vec4(c * knee, 1.0);
}`;

const UPSAMPLE = `${FRAGMENT_HEADER}
uniform sampler2D source;
uniform vec2 texel;
void main() {
  vec3 c = texture(source, uv).rgb * 4.0;
  c += (texture(source, uv + vec2(texel.x, 0.0)).rgb + texture(source, uv - vec2(texel.x, 0.0)).rgb) * 2.0;
  c += (texture(source, uv + vec2(0.0, texel.y)).rgb + texture(source, uv - vec2(0.0, texel.y)).rgb) * 2.0;
  c += texture(source, uv + texel).rgb + texture(source, uv - texel).rgb;
  c += texture(source, uv + vec2(texel.x, -texel.y)).rgb + texture(source, uv + vec2(-texel.x, texel.y)).rgb;
  color = vec4(c / 16.0, 1.0);
}`;

const FINAL = `${FRAGMENT_HEADER}
uniform sampler2D scene;
uniform sampler2D bloom;
uniform float bloomStrength;
uniform float seed;
/** A camera over the picture: offset (UV) and zoom, for the camera shake. */
uniform vec2 offset;
uniform float zoom;
/** Reduce flashing: 1 on; the brightness around here now, and its settled level (linear, R). */
uniform float calm;
uniform sampler2D levelNow;
uniform sampler2D levelSettled;

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Keeps colours up to 0.8 as they are and rolls off brighter values towards 1.
vec3 rolloff(vec3 c) {
  vec3 over = max(c - 0.8, 0.0);
  return min(c, 0.8) + 0.2 * (1.0 - exp(-over / 0.2));
}

void main() {
  vec2 at = (uv - 0.5) / zoom + 0.5 + offset;
  vec3 c = texture(scene, at).rgb + texture(bloom, at).rgb * bloomStrength;
  if (calm > 0.5) {
    // In linear light, the brightness around here rises at most 0.03 above its settled level,
    // which itself rises slowly: well under what counts as a flash (a change of 0.1).
    float now = pow(max(luma(texture(levelNow, at).rgb), 0.0), 2.2);
    float allowed = texture(levelSettled, at).r + 0.03;
    if (now > allowed) c *= pow(allowed / now, 1.0 / 2.2);
  }
  float noise = fract(sin(dot(gl_FragCoord.xy + seed, vec2(12.9898, 78.233))) * 43758.5453);
  color = vec4(rolloff(c) + (noise - 0.5) / 255.0, 1.0);
}`;

/**
 * Four bilinear taps: the average of the 4 × 4 texels a texel of the target covers. The first
 * reduction adds the bloom, so the limiter sees what is shown.
 */
const REDUCE = `${FRAGMENT_HEADER}
uniform sampler2D source;
uniform sampler2D glow;
uniform float glowStrength;
uniform vec2 texel;
vec3 shown(vec2 at) {
  return texture(source, at).rgb + texture(glow, at).rgb * glowStrength;
}
void main() {
  vec3 c = shown(uv + texel * vec2(-1.0, -1.0));
  c += shown(uv + texel * vec2(1.0, -1.0));
  c += shown(uv + texel * vec2(-1.0, 1.0));
  c += shown(uv + texel * vec2(1.0, 1.0));
  color = vec4(c * 0.25, 1.0);
}`;

/**
 * The settled level (linear light, in R) follows the reduced picture: up by at most `rise` in
 * this frame, down by `fall` of the way.
 */
const SETTLE = `${FRAGMENT_HEADER}
uniform sampler2D current;
uniform sampler2D previous;
uniform float rise;
uniform float fall;
uniform float fresh;
void main() {
  vec3 c = texture(current, uv).rgb;
  float now = pow(max(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0), 2.2);
  float before = texture(previous, uv).r;
  float level = fresh > 0.5 ? now : now > before ? min(now, before + rise) : mix(before, now, fall);
  color = vec4(level, 0.0, 0.0, 1.0);
}`;

const LEVELS = 6;
/**
 * The flash limiter looks at the picture reduced by 4, as often as leaves at least 12 texels
 * per side: 16 rows at 1080p, 33 at 4K, 28 on a small stage.
 */
function calmLevels(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.log(Math.min(width, height) / 12) / Math.log(4)));
}
/** The settled level rises at most this much per second (linear light), and falls this fast. */
const SETTLE_RISE = 0.1;
const SETTLE_FALL_SECONDS = 0.3;

/** Where the final pass looks at the picture: an offset (UV) and a zoom. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const NO_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

export class PostProcessing {
  private readonly gl: WebGL2RenderingContext;
  private readonly down: Program;
  private readonly up: Program;
  private readonly final: Program;
  private readonly reduce: Program;
  private readonly settle: Program;
  private readonly float: boolean;
  private chain: Target[] = [];
  private width = 1;
  private height = 1;
  /** Reduce flashing: on, the reduced picture, and its settled level [before, next]. */
  private calm = false;
  private levels: Target[] = [];
  private settled: [Target, Target] | null = null;
  /** The settled level starts from the next picture (after switching on or resizing). */
  private fresh = true;

  constructor(gl: WebGL2RenderingContext, float: boolean) {
    this.gl = gl;
    this.float = float;
    this.down = new Program(gl, FULLSCREEN_VERTEX, DOWNSAMPLE);
    this.up = new Program(gl, FULLSCREEN_VERTEX, UPSAMPLE);
    this.final = new Program(gl, FULLSCREEN_VERTEX, FINAL);
    this.reduce = new Program(gl, FULLSCREEN_VERTEX, REDUCE);
    this.settle = new Program(gl, FULLSCREEN_VERTEX, SETTLE);
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    for (const target of this.chain) deleteTarget(this.gl, target);
    this.chain = [];
    let w = width;
    let h = height;
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.chain.push(createTarget(this.gl, w, h, this.float));
    }
    if (this.calm) this.createLevels();
  }

  /** Reduce flashing (VE-06) on or off. */
  setReduceFlashing(on: boolean): void {
    if (on === this.calm) return;
    this.calm = on;
    if (on) this.createLevels();
    else this.deleteLevels();
  }

  /** The settled level, for a snapshot (null while reduce flashing is off or just started). */
  saveState(): SnapshotBuffer | null {
    if (!this.calm || !this.settled || this.fresh) return null;
    return readTarget(this.gl, this.settled[0], this.float);
  }

  /** Continues from a saved settled level (none: it starts from the next picture). */
  restoreState(buffer: SnapshotBuffer | null | undefined): void {
    if (!this.calm || !this.settled) return;
    if (buffer) writeTarget(this.gl, this.settled[0], buffer);
    this.fresh = !buffer;
  }

  /**
   * Adds bloom to `scene` and draws the result to the canvas (`width` × `height`). Expects the
   * full-screen triangle's vertex array to be bound.
   */
  present(
    scene: Target,
    bloom: number,
    width: number,
    height: number,
    frame: number,
    camera: Camera = NO_CAMERA,
    dt = 1 / 60,
  ): void {
    const gl = this.gl;
    const chain = this.chain;
    gl.disable(gl.BLEND);
    if (bloom > 0) {
      let source = scene;
      this.down.use();
      for (let i = 0; i < chain.length; i++) {
        const target = chain[i]!;
        bindTarget(gl, target, width, height);
        this.down
          .texture('source', source.texture, 0)
          .vec2('texel', 1 / source.width, 1 / source.height)
          .float('threshold', i === 0 ? 0.95 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        source = target;
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.up.use();
      for (let i = chain.length - 1; i > 0; i--) {
        const small = chain[i]!;
        bindTarget(gl, chain[i - 1]!, width, height);
        this.up
          .texture('source', small.texture, 0)
          .vec2('texel', 1 / small.width, 1 / small.height);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }
    const levels = this.calm ? this.reduceScene(scene, bloom > 0 ? bloom * 0.8 : 0) : null;
    bindTarget(gl, null, width, height);
    // Until the settled level has a picture, nothing is limited.
    const limit = levels !== null && !this.fresh;
    this.final
      .use()
      .texture('scene', scene.texture, 0)
      .texture('bloom', chain[0]!.texture, 1)
      .texture('levelNow', (levels ?? scene).texture, 2)
      .texture('levelSettled', (limit ? this.settled![0] : scene).texture, 3)
      .float('calm', limit ? 1 : 0)
      .float('bloomStrength', bloom * 0.8)
      .float('seed', (frame % 1024) * 1.618)
      .vec2('offset', camera.x, camera.y)
      .float('zoom', camera.zoom);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (levels) this.settleLevel(levels, dt);
  }

  dispose(): void {
    for (const target of this.chain) deleteTarget(this.gl, target);
    this.chain = [];
    this.deleteLevels();
  }

  /** The picture as shown (with `glow` of the bloom) reduced to the limiter's grid. */
  private reduceScene(scene: Target, glow: number): Target {
    const gl = this.gl;
    let source = scene;
    this.reduce.use();
    for (const target of this.levels) {
      bindTarget(gl, target, this.width, this.height);
      this.reduce
        .texture('source', source.texture, 0)
        .texture('glow', this.chain[0]!.texture, 1)
        .float('glowStrength', source === scene ? glow : 0)
        .vec2('texel', 1 / source.width, 1 / source.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      source = target;
    }
    return source;
  }

  /** Moves the settled level towards the reduced picture, by the frame's time. */
  private settleLevel(level: Target, dt: number): void {
    const gl = this.gl;
    const [before, next] = this.settled!;
    bindTarget(gl, next, this.width, this.height);
    const step = Math.max(0, dt);
    this.settle
      .use()
      .texture('current', level.texture, 0)
      .texture('previous', before.texture, 1)
      .float('rise', SETTLE_RISE * step)
      .float('fall', 1 - Math.exp(-step / SETTLE_FALL_SECONDS))
      .float('fresh', this.fresh ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.settled = [next, before];
    this.fresh = false;
  }

  private createLevels(): void {
    this.deleteLevels();
    let w = this.width;
    let h = this.height;
    const count = calmLevels(w, h);
    for (let i = 0; i < count; i++) {
      w = Math.max(1, Math.floor(w / 4));
      h = Math.max(1, Math.floor(h / 4));
      this.levels.push(createTarget(this.gl, w, h, this.float));
    }
    this.settled = [
      createTarget(this.gl, w, h, this.float),
      createTarget(this.gl, w, h, this.float),
    ];
    this.fresh = true;
  }

  private deleteLevels(): void {
    for (const target of this.levels) deleteTarget(this.gl, target);
    this.levels = [];
    if (this.settled) for (const target of this.settled) deleteTarget(this.gl, target);
    this.settled = null;
  }
}
