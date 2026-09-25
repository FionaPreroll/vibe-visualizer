/**
 * Minimal WebGL2 animated test pattern (plasma + moving bars) on an OffscreenCanvas. Detailed
 * enough to give video encoders realistic work, cheap enough not to be the bottleneck.
 */
const VERTEX = `#version 300 es
in vec2 position;
out vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
uniform float time;
uniform vec2 resolution;
out vec4 color;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = (uv - 0.5) * vec2(resolution.x / resolution.y, 1.0) * 3.0;
  float v = sin(p.x * 2.0 + time) + sin(p.y * 3.0 - time * 1.3)
          + sin(length(p) * 4.0 - time * 2.0) + sin(atan(p.y, p.x) * 5.0 + time);
  vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + v + time * 0.5);
  float bar = step(0.96, fract(uv.x * 8.0 - time * 0.4));
  float grain = hash(floor(uv * resolution) + time) * 0.08;
  color = vec4(col * (1.0 - bar * 0.7) + grain, 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
  }
  return shader;
}

export class GlTestPattern {
  readonly canvas: OffscreenCanvas;
  private readonly gl: WebGL2RenderingContext;
  private readonly timeLocation: WebGLUniformLocation | null;

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program link error: ${gl.getProgramInfoLog(program)}`);
    }
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(program, 'resolution'), width, height);
    this.timeLocation = gl.getUniformLocation(program, 'time');
    gl.viewport(0, 0, width, height);
  }

  draw(time: number): void {
    this.gl.uniform1f(this.timeLocation, time);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
