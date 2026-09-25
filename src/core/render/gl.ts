/**
 * Small WebGL2 toolkit for the scenes: shader programs with named uniforms, float render
 * targets (VE-02: no colour banding), textures and a full-screen triangle.
 */

export const FULLSCREEN_VERTEX = `#version 300 es
layout(location = 0) in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

/** Common header of full-screen fragment shaders. */
export const FRAGMENT_HEADER = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
`;

export class Program {
  readonly program: WebGLProgram;
  private readonly uniforms = new Map<string, WebGLUniformLocation>();
  private readonly gl: WebGL2RenderingContext;

  constructor(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
      }
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    const count = (gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number) ?? 0;
    for (let i = 0; i < count; i++) {
      const info = gl.getActiveUniform(program, i)!;
      const location = gl.getUniformLocation(program, info.name);
      if (location) this.uniforms.set(info.name.replace(/\[0\]$/, ''), location);
    }
    this.program = program;
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  uniform(name: string): WebGLUniformLocation | null {
    return this.uniforms.get(name) ?? null;
  }

  float(name: string, value: number): this {
    this.gl.uniform1f(this.uniform(name), value);
    return this;
  }

  int(name: string, value: number): this {
    this.gl.uniform1i(this.uniform(name), value);
    return this;
  }

  vec2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.uniform(name), x, y);
    return this;
  }

  vec3(name: string, x: number, y: number, z: number): this {
    this.gl.uniform3f(this.uniform(name), x, y, z);
    return this;
  }

  vec3Array(name: string, values: Float32Array): this {
    this.gl.uniform3fv(this.uniform(name), values);
    return this;
  }

  /** Binds `texture` to texture unit `unit` and points the sampler `name` at it. */
  texture(name: string, texture: WebGLTexture | null, unit: number): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(this.uniform(name), unit);
    return this;
  }
}

export interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

/** Whether RGBA16F render targets work (they do on all WebGL2 desktop GPUs in practice). */
export function supportsFloatTargets(gl: WebGL2RenderingContext): boolean {
  const ok = !!gl.getExtension('EXT_color_buffer_float');
  gl.getExtension('OES_texture_float_linear');
  return ok;
}

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  float: boolean,
): Target {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  if (float) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
  } else {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  setSampling(gl, gl.LINEAR, gl.CLAMP_TO_EDGE);
  const framebuffer = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    throw new Error(`Render target incomplete (status 0x${status.toString(16)})`);
  }
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { texture, framebuffer, width, height };
}

export function deleteTarget(gl: WebGL2RenderingContext, target: Target | null): void {
  if (!target) return;
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

export function setSampling(gl: WebGL2RenderingContext, filter: number, wrap: number): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
}

/**
 * Uploads an image as an 8-bit texture with mipmaps (for smooth downscaling). WebGL ignores
 * the flip and premultiply flags for ImageBitmaps, so the texture has the image's top row at
 * v = 0 and straight alpha: shaders flip v and premultiply themselves.
 */
export function createImageTexture(gl: WebGL2RenderingContext, image: ImageBitmap): WebGLTexture {
  const texture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

/** A vertex array with one full-screen triangle at attribute location 0. */
export function createFullscreenTriangle(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  return vao;
}

/** Binds `target` (or the canvas for null) as the render destination. */
export function bindTarget(
  gl: WebGL2RenderingContext,
  target: Target | null,
  width: number,
  height: number,
): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, target?.framebuffer ?? null);
  gl.viewport(0, 0, target?.width ?? width, target?.height ?? height);
}
