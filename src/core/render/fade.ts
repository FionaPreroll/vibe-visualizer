import { Program } from './gl';

/**
 * Darkens the picture on the canvas towards black, for the fades at the start and the end of a
 * video (EX-16): the blending keeps `gain` of what is there, the overlay included.
 */

const VERTEX = `#version 300 es
void main() {
  // One triangle that covers the canvas.
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;
out vec4 color;
void main() {
  color = vec4(0.0);
}`;

export class PictureFade {
  private readonly program: Program;
  private readonly vertexArray: WebGLVertexArrayObject;

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = new Program(gl, VERTEX, FRAGMENT);
    this.vertexArray = gl.createVertexArray()!;
  }

  /** Keeps `gain` (0…1) of the picture on the canvas of `width` × `height`. */
  draw(gain: number, width: number, height: number): void {
    if (gain >= 1) return;
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, width, height);
    gl.enable(gl.BLEND);
    gl.blendColor(0, 0, 0, Math.max(0, gain));
    gl.blendFunc(gl.ZERO, gl.CONSTANT_ALPHA);
    gl.bindVertexArray(this.vertexArray);
    this.program.use();
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.deleteVertexArray(this.vertexArray);
  }
}
