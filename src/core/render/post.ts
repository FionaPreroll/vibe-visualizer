import {
  bindTarget,
  createTarget,
  deleteTarget,
  FRAGMENT_HEADER,
  FULLSCREEN_VERTEX,
  Program,
  type Target,
} from './gl';

/**
 * Post-processing shared by the scenes: bloom (threshold, downsample chain, tent upsampling)
 * and the final pass to the canvas with a soft highlight roll-off and dithering (VE-02).
 * Scenes render in sRGB space into a half-float target; values above 1 are highlights.
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

// Keeps colours up to 0.8 as they are and rolls off brighter values towards 1.
vec3 rolloff(vec3 c) {
  vec3 over = max(c - 0.8, 0.0);
  return min(c, 0.8) + 0.2 * (1.0 - exp(-over / 0.2));
}

void main() {
  vec3 c = texture(scene, uv).rgb + texture(bloom, uv).rgb * bloomStrength;
  float noise = fract(sin(dot(gl_FragCoord.xy + seed, vec2(12.9898, 78.233))) * 43758.5453);
  color = vec4(rolloff(c) + (noise - 0.5) / 255.0, 1.0);
}`;

const LEVELS = 6;

export class PostProcessing {
  private readonly gl: WebGL2RenderingContext;
  private readonly down: Program;
  private readonly up: Program;
  private readonly final: Program;
  private readonly float: boolean;
  private chain: Target[] = [];

  constructor(gl: WebGL2RenderingContext, float: boolean) {
    this.gl = gl;
    this.float = float;
    this.down = new Program(gl, FULLSCREEN_VERTEX, DOWNSAMPLE);
    this.up = new Program(gl, FULLSCREEN_VERTEX, UPSAMPLE);
    this.final = new Program(gl, FULLSCREEN_VERTEX, FINAL);
  }

  resize(width: number, height: number): void {
    for (const target of this.chain) deleteTarget(this.gl, target);
    this.chain = [];
    let w = width;
    let h = height;
    for (let i = 0; i < LEVELS; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      this.chain.push(createTarget(this.gl, w, h, this.float));
    }
  }

  /**
   * Adds bloom to `scene` and draws the result to the canvas (`width` × `height`). Expects the
   * full-screen triangle's vertex array to be bound.
   */
  present(scene: Target, bloom: number, width: number, height: number, frame: number): void {
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
    bindTarget(gl, null, width, height);
    this.final
      .use()
      .texture('scene', scene.texture, 0)
      .texture('bloom', chain[0]!.texture, 1)
      .float('bloomStrength', bloom * 0.8)
      .float('seed', (frame % 1024) * 1.618);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    for (const target of this.chain) deleteTarget(this.gl, target);
    this.chain = [];
  }
}
