/**
 * Prototype of the Mode A render pipeline (spike S4): MilkDrop-style float feedback, kaleidoscope
 * fold, bloom and tonemapping with dithering. Driven by synthetic "audio" features.
 * Frame-rate independent: every per-frame factor is scaled by the elapsed time.
 */

export interface SceneFeatures {
  kick: number;
  hat: number;
  energy: number;
}

/** 120 BPM kick, 8th-note hats and a slow energy swell, as a function of time. */
export function syntheticFeatures(time: number): SceneFeatures {
  return {
    kick: Math.exp(-(time % 0.5) * 9),
    hat: Math.exp(-(time % 0.25) * 30),
    energy: 0.5 + 0.5 * Math.sin(time * 0.4),
  };
}

const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const HEADER = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
`;

const FEEDBACK = `${HEADER}
uniform sampler2D previous;
uniform vec2 resolution;
uniform float time;
uniform float dt;
uniform float kick;
uniform float hat;
uniform float energy;

vec3 palette(float t) {
  return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.18, 0.42)));
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspect;
  float r = length(p);
  float frames = dt * 60.0;

  // Warp the previous frame: zoom (content flows outward), rotate and swirl.
  float zoom = pow(1.0 - (0.012 + 0.035 * kick), frames);
  float angle = (0.004 + 0.012 * energy) * frames + 0.03 * r * sin(time * 0.3) * frames;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 q = rotation * (p * zoom);
  vec3 previousColor = texture(previous, q / aspect + 0.5).rgb;
  vec3 col = previousColor * pow(0.94, frames);

  // Emitter: a pulsing star outline in the centre.
  float a = atan(p.y, p.x);
  float radius = 0.1 + 0.025 * sin(a * 8.0 + time * 2.0) + 0.06 * kick;
  float ring = smoothstep(0.01, 0.0, abs(r - radius));
  col += ring * palette(time * 0.05 + r * 2.0) * (1.2 + 3.0 * kick);

  // Sparks on the hi-hats.
  float spark = step(0.996, hash(floor(p * 80.0) + floor(time * 8.0))) * hat;
  col += spark * vec3(0.2, 1.0, 0.8) * 3.0;

  color = vec4(col, 1.0);
}`;

const KALEIDO = `${HEADER}
uniform sampler2D feedback;
uniform vec2 resolution;
uniform float time;
uniform float segments;

void main() {
  vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
  vec2 p = (uv - 0.5) * aspect;
  float r = length(p);
  float segment = 6.28318 / segments;
  float a = mod(atan(p.y, p.x) + time * 0.05, segment);
  a = abs(a - segment * 0.5);
  vec2 folded = vec2(cos(a), sin(a)) * r;
  color = vec4(texture(feedback, folded / aspect + 0.5).rgb, 1.0);
}`;

const DOWNSAMPLE = `${HEADER}
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
  color = vec4(max(c - threshold, 0.0), 1.0);
}`;

const UPSAMPLE = `${HEADER}
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

const FINAL = `${HEADER}
uniform sampler2D scene;
uniform sampler2D bloom;
uniform float bloomStrength;
uniform float time;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

void main() {
  vec3 hdr = texture(scene, uv).rgb + texture(bloom, uv).rgb * bloomStrength;
  vec3 ldr = pow(aces(hdr), vec3(1.0 / 2.2));
  float noise = fract(sin(dot(gl_FragCoord.xy + fract(time) * 97.0, vec2(12.9898, 78.233))) * 43758.5453);
  color = vec4(ldr + (noise - 0.5) / 255.0, 1.0);
}`;

interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, WebGLUniformLocation>;
}

const BLOOM_LEVELS = 5;

type ProgramName = 'feedback' | 'kaleido' | 'down' | 'up' | 'final';

export class KaleidoFeedbackScene {
  /** True when half-float render targets work (needed for banding-free HD feedback). */
  readonly floatTargets: boolean;
  private readonly gl: WebGL2RenderingContext;
  private readonly programs: Record<ProgramName, Program>;
  private feedback: [Target, Target];
  private sceneTarget: Target;
  private bloom: Target[];
  private width: number;
  private height: number;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.floatTargets = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.programs = {
      feedback: this.createProgram(FEEDBACK),
      kaleido: this.createProgram(KALEIDO),
      down: this.createProgram(DOWNSAMPLE),
      up: this.createProgram(UPSAMPLE),
      final: this.createProgram(FINAL),
    };
    this.feedback = [this.createTarget(width, height), this.createTarget(width, height)];
    this.sceneTarget = this.createTarget(width, height);
    this.bloom = this.createBloomChain(width, height);
  }

  render(time: number, dt: number, features: SceneFeatures): void {
    const gl = this.gl;
    const [previous, next] = this.feedback;

    this.pass('feedback', next, { previous: previous.texture }, (u) => {
      gl.uniform2f(u('resolution'), this.width, this.height);
      gl.uniform1f(u('time'), time);
      gl.uniform1f(u('dt'), Math.min(dt, 0.1));
      gl.uniform1f(u('kick'), features.kick);
      gl.uniform1f(u('hat'), features.hat);
      gl.uniform1f(u('energy'), features.energy);
    });
    this.feedback = [next, previous];

    this.pass('kaleido', this.sceneTarget, { feedback: next.texture }, (u) => {
      gl.uniform2f(u('resolution'), this.width, this.height);
      gl.uniform1f(u('time'), time);
      gl.uniform1f(u('segments'), 8);
    });

    // Bloom: threshold + downsample chain, then additive tent upsampling.
    let source = this.sceneTarget;
    for (let i = 0; i < this.bloom.length; i++) {
      const target = this.bloom[i]!;
      this.pass('down', target, { source: source.texture }, (u) => {
        gl.uniform2f(u('texel'), 1 / source.width, 1 / source.height);
        gl.uniform1f(u('threshold'), i === 0 ? 0.8 : 0);
      });
      source = target;
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = this.bloom.length - 1; i > 0; i--) {
      const small = this.bloom[i]!;
      this.pass('up', this.bloom[i - 1]!, { source: small.texture }, (u) => {
        gl.uniform2f(u('texel'), 1 / small.width, 1 / small.height);
      });
    }
    gl.disable(gl.BLEND);

    this.pass(
      'final',
      null,
      { scene: this.sceneTarget.texture, bloom: this.bloom[0]!.texture },
      (u) => {
        gl.uniform1f(u('bloomStrength'), 0.6);
        gl.uniform1f(u('time'), time);
      },
    );
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private pass(
    name: ProgramName,
    target: Target | null,
    textures: Record<string, WebGLTexture>,
    setUniforms: (uniform: (name: string) => WebGLUniformLocation | null) => void,
  ): void {
    const gl = this.gl;
    const { program, uniforms } = this.programs[name];
    gl.useProgram(program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
    gl.viewport(0, 0, target?.width ?? this.width, target?.height ?? this.height);
    let unit = 0;
    for (const [uniformName, texture] of Object.entries(textures)) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.get(uniformName) ?? null, unit);
      unit++;
    }
    setUniforms((uniformName) => uniforms.get(uniformName) ?? null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private createProgram(fragment: string): Program {
    const gl = this.gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'position');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    const uniforms = new Map<string, WebGLUniformLocation>();
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)!;
      const location = gl.getUniformLocation(program, info.name);
      if (location) uniforms.set(info.name, location);
    }
    return { program, uniforms };
  }

  private createTarget(width: number, height: number): Target {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (this.floatTargets) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error(`Render target incomplete (status 0x${status.toString(16)})`);
    }
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, framebuffer, width, height };
  }

  private createBloomChain(width: number, height: number): Target[] {
    const chain: Target[] = [];
    let w = width;
    let h = height;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      w = Math.max(1, Math.floor(w / 2));
      h = Math.max(1, Math.floor(h / 2));
      chain.push(this.createTarget(w, h));
    }
    return chain;
  }
}
