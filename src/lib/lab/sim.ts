import { VERT, STEP, STATS, PAINT, DRAW } from "./shaders";
import { K, GENOME_LEN, population, observe, evolve } from "./evolve";

const STAT_BLOCK = 8;
const STAT_EVERY = 30;
const EPOCH_STEPS = 600;
// Alive cells (of the grid) the world can support before growth stalls.
const BUDGET = 0.7;

type Target = { fb: WebGLFramebuffer; mass: WebGLTexture; hid: WebGLTexture };

export class Sim {
  steps = 0;
  shares = new Float32Array(K);
  coverage = 0;
  private gl: WebGL2RenderingContext;
  private progs: Record<"step" | "stats" | "paint" | "draw", WebGLProgram>;
  private targets: [Target, Target];
  private weights: WebGLTexture;
  private stats: { fb: WebGLFramebuffer; buf: Float32Array };
  private growth = new Float32Array(K).fill(1);
  private upkeep = new Float32Array(K).fill(1);

  /** Grid dimensions must be multiples of 8; the caller sizes the canvas. Throws if WebGL2 or float render targets are unavailable. */
  constructor(
    canvas: HTMLCanvasElement,
    readonly w: number,
    readonly h: number,
  ) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true });
    if (!gl || !gl.getExtension("EXT_color_buffer_float")) throw new Error("unsupported");
    this.gl = gl;
    this.progs = {
      step: this.program(STEP),
      stats: this.program(STATS),
      paint: this.program(PAINT),
      draw: this.program(DRAW),
    };
    this.targets = [this.target(), this.target()];
    this.weights = this.texture(GENOME_LEN / 4, K);
    const statTex = this.texture(w / STAT_BLOCK, h / STAT_BLOCK);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, statTex, 0);
    this.stats = { fb, buf: new Float32Array((w * h) / STAT_BLOCK / STAT_BLOCK * 4) };
    gl.bindVertexArray(gl.createVertexArray());
    population.forEach((_, i) => this.upload(i));
    for (let i = 0; i < K; i++) {
      const a = (i / K) * Math.PI * 2 + Math.random();
      this.paint(w / 2 + Math.cos(a) * w * 0.3, h / 2 + Math.sin(a) * h * 0.3, Math.min(w, h) / 8, i);
    }
  }

  private program(frag: string) {
    const gl = this.gl;
    const p = gl.createProgram()!;
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, frag]] as const) {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "");
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    return p;
  }

  private texture(w: number, h: number) {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return t;
  }

  private target(): Target {
    const gl = this.gl;
    const mass = this.texture(this.w, this.h);
    const hid = this.texture(this.w, this.h);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, mass, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, hid, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0]);
    return { fb, mass, hid };
  }

  private upload(slot: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.weights);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, slot, GENOME_LEN / 4, 1, gl.RGBA, gl.FLOAT, population[slot].genome.weights);
  }

  /** Run one pass reading the current state; writes to `out` (or the next state). */
  private pass(
    prog: WebGLProgram,
    uniforms: (u: (n: string) => WebGLUniformLocation | null) => void,
    out?: WebGLFramebuffer | null,
    size = [this.w, this.h],
  ) {
    const gl = this.gl;
    const [src, dst] = this.targets;
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, src.mass);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, src.hid);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.weights);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    gl.uniform1i(u("u_mass"), 0);
    gl.uniform1i(u("u_hid"), 1);
    gl.uniform1i(u("u_w"), 2);
    uniforms(u);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out === undefined ? dst.fb : out);
    gl.viewport(0, 0, size[0], size[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (out === undefined) this.targets.reverse();
  }

  paint(x: number, y: number, radius: number, species = -1, keep = [1, 1, 1, 1]) {
    this.pass(this.progs.paint, (u) => {
      this.gl.uniform2f(u("u_at"), x, y);
      this.gl.uniform1f(u("u_radius"), radius);
      this.gl.uniform1i(u("u_species"), species);
      this.gl.uniform4fv(u("u_keep"), keep);
    });
  }

  step() {
    this.pass(this.progs.step, (u) => {
      this.gl.uniform4fv(u("u_growth"), this.growth);
      this.gl.uniform4fv(u("u_upkeep"), this.upkeep);
      this.gl.uniform1f(u("u_seed"), Math.random() * 100);
    });
    if (++this.steps % STAT_EVERY === 0) this.measure();
    if (this.steps % EPOCH_STEPS === 0) {
      const slot = evolve();
      this.upload(slot);
      const keep = [1, 1, 1, 1];
      keep[slot] = 0;
      this.paint(Math.random() * this.w, Math.random() * this.h, Math.min(this.w, this.h) / 8, slot, keep);
    }
  }

  private measure() {
    const gl = this.gl;
    const [sw, sh] = [this.w / STAT_BLOCK, this.h / STAT_BLOCK];
    this.pass(this.progs.stats, (u) => gl.uniform1i(u("u_block"), STAT_BLOCK), this.stats.fb, [sw, sh]);
    gl.readPixels(0, 0, sw, sh, gl.RGBA, gl.FLOAT, this.stats.buf);
    const counts = new Float32Array(K);
    this.stats.buf.forEach((v, i) => (counts[i % 4] += v));
    const alive = counts.reduce((a, b) => a + b, 0);
    this.coverage = alive / (this.w * this.h);
    counts.forEach((c, i) => (this.shares[i] = alive ? c / alive : 0));
    observe(this.shares);
    const room = Math.min(1, Math.max(0, (BUDGET - this.coverage) * 8));
    // Large empires grow slower and cost more to maintain, so no species sweeps the board.
    this.shares.forEach((s, i) => {
      this.growth[i] = room * Math.min(1.5, Math.max(0.1, 1.6 - 2.4 * s));
      this.upkeep[i] = 1 + 8 * Math.max(0, s - 0.3);
    });
  }

  /** Draw cover-fit to the canvas's current drawing buffer; `colors` is K rgb triples in 0..1. */
  draw(colors: number[]) {
    const gl = this.gl;
    const [cw, ch] = [gl.drawingBufferWidth, gl.drawingBufferHeight];
    const cell = Math.max(cw / this.w, ch / this.h);
    this.pass(
      this.progs.draw,
      (u) => {
        gl.uniform3fv(u("u_colors"), colors);
        gl.uniform1f(u("u_cell"), cell);
        gl.uniform2f(u("u_offset"), (cw - cell * this.w) / 2, (ch - cell * this.h) / 2);
        gl.uniform1f(u("u_height"), ch);
      },
      null,
      [cw, ch],
    );
  }

  destroy() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
