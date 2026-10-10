import { Sim } from "./sim";
import { population, epoch } from "./evolve";

export { GENOME_LEN, bestGenomes, injectMigrant, type Genome } from "./evolve";

/** Legend symbol per species slot, matching the glyphs the shader draws. */
export const GLYPHS = ["●", "+", "○", "×"];

export type LabStatus = {
  generation: number;
  species: number;
  lineage: string;
  /** Slot of the leading species; index into GLYPHS. */
  leader: number;
  steps: number;
  shares: number[];
  /** Free-form line owned by the genome hub client, e.g. "3 browsers contributing · pool 41". */
  hub: string | null;
};

let sim: Sim | null = null;
let canvas: HTMLCanvasElement;
let raf = 0;
let frame = 0;
let hub: string | null = null;
let last: LabStatus | null = null;
let ink = { accent: [0, 0, 0], muted: [0, 0, 0] };
const listeners = new Set<(s: LabStatus) => void>();
const coarse = () => matchMedia("(pointer: coarse)").matches;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function leader() {
  return population.reduce((best, s, i) => (s.share > population[best].share ? i : best), 0);
}

function emit() {
  if (!sim) return;
  const lead = leader();
  last = {
    generation: epoch,
    species: population.filter((s) => s.share > 0).length,
    lineage: population[lead].genome.id,
    leader: lead,
    steps: sim.steps,
    shares: Array.from(sim.shares),
    hub,
  };
  listeners.forEach((cb) => cb(last!));
}

/** Subscribe to status updates; fires immediately with the latest status. Returns an unsubscribe. */
export function onStatus(cb: (s: LabStatus) => void): () => void {
  listeners.add(cb);
  if (last) cb(last);
  return () => listeners.delete(cb);
}

export function setHub(text: string | null) {
  hub = text;
  emit();
}

// Theme tokens may be oklch(); a 2D canvas resolves any CSS colour to sRGB.
function readInk() {
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!;
  const style = getComputedStyle(document.documentElement);
  const rgb = (name: string) => {
    ctx.fillStyle = style.getPropertyValue(name).trim();
    ctx.fillRect(0, 0, 1, 1);
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3), (v) => v / 255);
  };
  ink = { accent: rgb("--color-accent"), muted: rgb("--color-muted") };
}

function draw() {
  const lead = leader();
  sim!.draw(population.flatMap((_, i) => (i === lead ? ink.accent : ink.muted)));
}

function fit() {
  const dpr = Math.min(devicePixelRatio, coarse() ? 1.5 : 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  if (sim) draw();
}

function tick() {
  raf = requestAnimationFrame(tick);
  // Phones step every other frame to stay within a modest GPU budget.
  if (coarse() && frame++ % 2) return;
  sim!.step();
  draw();
  if (sim!.steps % 30 === 0) emit();
}

function resume() {
  cancelAnimationFrame(raf);
  if (sim && !document.hidden && !reduced()) raf = requestAnimationFrame(tick);
}

const themeObserver = new MutationObserver(() => (readInk(), sim && draw()));

/** Start (or keep running) the sim on `el`. Returns false if WebGL2 float targets are unavailable. */
export function start(el: HTMLCanvasElement): boolean {
  if (sim) return resume(), true;
  canvas = el;
  const cell = coarse() ? 12 : 14;
  const grid = (px: number, hi: number) => Math.min(hi, Math.max(32, Math.round(px / cell / 8) * 8));
  try {
    sim = new Sim(canvas, grid(innerWidth, 160), grid(innerHeight, 112));
  } catch {
    return false;
  }
  readInk();
  fit();
  if (reduced()) {
    for (let i = 0; i < 400; i++) sim.step();
    draw();
  }
  emit();
  addEventListener("resize", fit);
  document.addEventListener("visibilitychange", resume);
  themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  resume();
  return true;
}

export function stop() {
  cancelAnimationFrame(raf);
  removeEventListener("resize", fit);
  document.removeEventListener("visibilitychange", resume);
  themeObserver.disconnect();
  sim?.destroy();
  sim = null;
}
