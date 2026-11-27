import type { Point, Waterways } from './course.js';

const VERTEX = `
attribute vec2 corner;
varying vec2 uv;
void main() {
  uv = corner * 0.5 + 0.5;
  gl_Position = vec4(corner, 0.0, 1.0);
}`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 uv;
uniform sampler2D sea;
uniform vec2 viewSize;
uniform vec2 cover;
uniform vec4 lensA;
uniform vec4 lensB;

vec3 displacement(vec2 point, vec4 lens) {
  vec2 delta = point - lens.xy;
  vec2 radial = delta / lens.z;
  float falloff = max(0.0, 1.0 - dot(radial, radial));
  float zoom = lens.w * falloff * falloff;
  return vec3(-delta * zoom / (1.0 + zoom), falloff * sign(lens.w));
}

void main() {
  vec2 point = uv * viewSize;
  vec3 a = displacement(point, lensA);
  vec3 b = displacement(point, lensB);
  float rim = max(a.z, b.z);
  if (rim <= 0.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 warped = (point + a.xy + b.xy) / viewSize;
  vec2 texturePoint = (warped - 0.5) * cover + 0.5;
  gl_FragColor = vec4(texture2D(sea, texturePoint).rgb, smoothstep(0.0, 0.39, rim));
}`;

interface Swell {
  center: Point;
  radius: number;
  phase: number;
  period: number;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'Shader compilation failed');
  return shader;
}

function makeRenderer(canvas: HTMLCanvasElement, image: HTMLImageElement) {
  const gl = canvas.getContext('webgl', { antialias: false, depth: false, premultipliedAlpha: false });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'Shader link failed');
  gl.useProgram(program);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const corner = gl.getAttribLocation(program, 'corner');
  gl.enableVertexAttribArray(corner);
  gl.vertexAttribPointer(corner, 2, gl.FLOAT, false, 0, 0);

  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const view = gl.getUniformLocation(program, 'viewSize');
  const cover = gl.getUniformLocation(program, 'cover');
  const lenses = [gl.getUniformLocation(program, 'lensA'), gl.getUniformLocation(program, 'lensB')];
  return { gl, view, cover, lenses };
}

export class OceanWaves {
  private renderer?: ReturnType<typeof makeRenderer>;
  private swells: Swell[] = [];
  private width = 0;
  private height = 0;
  private started?: number;
  private previousFrame = -Infinity;

  constructor(private canvas: HTMLCanvasElement, private texture: HTMLImageElement) {
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      this.stop();
      this.renderer = null;
    });
    canvas.addEventListener('webglcontextrestored', () => { this.renderer = undefined; });
  }

  place(water: Waterways, width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.swells = [];
    const radius = Math.min(145, Math.min(width, height) * .23);
    const margin = radius * 1.24;
    for (let attempt = 0; attempt < 36 && this.swells.length < 2; attempt++) {
      const center = {
        x: margin + Math.random() * (width - 2 * margin),
        y: margin + Math.random() * (height - 2 * margin),
      };
      if (!water.openWater(center, radius * .4) ||
          this.swells.some(swell => Math.hypot(center.x - swell.center.x, center.y - swell.center.y) < radius * 1.75)) continue;
      this.swells.push({ center, radius, phase: Math.random() * 2 * Math.PI, period: 12 + Math.random() * 8 });
    }
    this.sizeRenderer();
  }

  private sizeRenderer(): void {
    if (!this.renderer) return;
    const { gl, view, cover } = this.renderer;
    const { width, height, texture, canvas } = this;
    const pixels = Math.min(devicePixelRatio, 1.5);
    canvas.width = Math.round(width * pixels);
    canvas.height = Math.round(height * pixels);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const scale = Math.max(width / texture.naturalWidth, height / texture.naturalHeight);
    gl.uniform2f(view, width, height);
    gl.uniform2f(cover, width / (texture.naturalWidth * scale), height / (texture.naturalHeight * scale));
  }

  draw(now: number): void {
    if (!this.swells.length || now - this.previousFrame < 30) return;
    if (this.renderer === undefined) {
      try {
        this.renderer = makeRenderer(this.canvas, this.texture);
        this.sizeRenderer();
      } catch (error) {
        console.warn('Sea chart wave rendering is unavailable', error);
        this.renderer = null;
      }
    }
    if (!this.renderer) return;
    const { gl, lenses } = this.renderer;
    if (this.started === undefined) {
      this.started = now;
      this.canvas.classList.add('moving');
    }
    this.previousFrame = now;
    const seconds = (now - this.started) / 1000;

    lenses.forEach((uniform, index) => {
      const swell = this.swells[index];
      if (!swell) {
        gl.uniform4f(uniform, 0, 0, 1, 0);
        return;
      }
      const { center, radius, phase, period } = swell;
      const turn = phase + seconds / period * 2 * Math.PI;
      const x = center.x + Math.cos(turn) * radius * .23;
      const y = center.y + Math.sin(turn) * radius * .17;
      const zoom = .39 + Math.sin(turn - .6) * .13;
      gl.uniform4f(uniform, x, this.height - y, radius, zoom);
    });
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  stop(): void {
    this.started = undefined;
    this.previousFrame = -Infinity;
    this.canvas.classList.remove('moving');
  }
}
