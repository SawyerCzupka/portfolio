import { Sim } from "./sim";
import { population, epoch, GENOME_LEN, type Species } from "./evolve";
import { buildTextMask, overContent } from "./textmask";

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

/** An inspected cell's viewport position and its species (null once that lineage is gone). */
export type Inspection = { x: number; y: number; id: string; slot: number; species: Species | null; params: number };

let sim: Sim | null = null;
let canvas: HTMLCanvasElement;
let raf = 0;
let frame = 0;
let hub: string | null = null;
let last: LabStatus | null = null;
let ink = { accent: [0, 0, 0], muted: [0, 0, 0] };
let inspected: { x: number; pageY: number; id: string } | null = null;
let floating: Element[] = [];
const listeners = new Set<(s: LabStatus) => void>();
const inspectors = new Set<(i: Inspection | null) => void>();
const coarse = () => matchMedia("(pointer: coarse)").matches;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const dpr = () => Math.min(devicePixelRatio, coarse() ? 1.5 : 2);
const running = () => raf !== 0;

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

/** Subscribe to the inspected specimen; fires on every redraw while one is selected. */
export function onInspect(cb: (i: Inspection | null) => void): () => void {
  inspectors.add(cb);
  return () => inspectors.delete(cb);
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
  if (!sim) return;
  const lead = leader();
  const rects = floating.slice(0, 4).flatMap((el) => {
    const r = el.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  });
  sim.draw(population.flatMap((_, i) => (i === lead ? ink.accent : ink.muted)), scrollY, dpr(), rects);
  if (!inspected) return inspectors.forEach((cb) => cb(null));
  const slot = population.findIndex((s) => s.genome.id === inspected!.id);
  const info = {
    x: inspected.x,
    y: inspected.pageY - scrollY,
    id: inspected.id,
    slot,
    species: population[slot] ?? null,
    params: GENOME_LEN,
  };
  inspectors.forEach((cb) => cb(info));
}

const redraw = () => running() || draw();

function fit() {
  canvas.width = Math.round(innerWidth * dpr());
  canvas.height = Math.round(innerHeight * dpr());
  remask();
}

let maskTimer = 0;
const bodyObserver = new ResizeObserver(() => {
  clearTimeout(maskTimer);
  maskTimer = window.setTimeout(remask, 150);
});

function remask() {
  if (!sim) return;
  const m = buildTextMask();
  sim.setMask(m.canvas, m.w, m.h);
  floating = m.floating;
  redraw();
}

/** Rebuild the text mask after the page content changes (e.g. a client-side navigation). */
export function refresh() {
  inspected = null;
  bodyObserver.disconnect();
  bodyObserver.observe(document.body);
  remask();
}

function tick() {
  raf = requestAnimationFrame(tick);
  // Phones step every other frame for GPU budget, but redraw every frame so scrolling stays smooth.
  if (!coarse() || frame++ % 2) {
    sim!.step();
    if (sim!.steps % 30 === 0) emit();
  }
  draw();
}

function resume() {
  cancelAnimationFrame(raf);
  raf = 0;
  if (sim && !document.hidden && !reduced()) raf = requestAnimationFrame(tick);
}

let drag: { x: number; y: number; moved: boolean } | null = null;

function onDown(e: PointerEvent) {
  if (!e.isPrimary || e.button !== 0 || overContent(e.clientX, e.clientY, e.target as Element)) return;
  drag = { x: e.clientX, y: e.clientY, moved: false };
  // Keeps a drag across empty background from turning into a text selection.
  if (e.pointerType === "mouse") e.preventDefault();
}

function onMove(e: PointerEvent) {
  // Touch drags scroll the page, so only mouse and pen erase.
  if (!drag || !sim || e.pointerType === "touch") return;
  const dist = Math.hypot(e.clientX - drag.x, e.clientY - drag.y);
  if (!drag.moved && dist < 6) return;
  for (let i = 1, n = Math.ceil(dist / 6); i <= n; i++) {
    const c = sim.cellAt(drag.x + ((e.clientX - drag.x) * i) / n, drag.y + ((e.clientY - drag.y) * i) / n, scrollY, dpr());
    sim.paint(c.x, c.y, 2.5);
  }
  drag = { x: e.clientX, y: e.clientY, moved: true };
  redraw();
}

function onUp(e: PointerEvent) {
  if (drag && !drag.moved && sim) {
    const c = sim.cellAt(e.clientX, e.clientY, scrollY, dpr());
    const slot = sim.probe(c.x, c.y);
    inspected = slot === null ? null : { x: e.clientX, pageY: e.clientY + scrollY, id: population[slot].genome.id };
    draw();
  }
  drag = null;
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && inspected) (inspected = null), draw();
}

const themeObserver = new MutationObserver(() => (readInk(), redraw()));

/** Start (or keep running) the sim on `el`. Returns false if WebGL2 float targets are unavailable. */
export function start(el: HTMLCanvasElement): boolean {
  if (sim) return resume(), true;
  canvas = el;
  const cell = coarse() ? 12 : 14;
  const grid = (px: number, hi: number) => Math.min(hi, Math.max(32, Math.round(px / cell / 8) * 8));
  try {
    // About two viewports tall, so the scrolling torus doesn't visibly repeat.
    sim = new Sim(canvas, grid(innerWidth, 160), grid(innerHeight * 2, 192));
  } catch {
    return false;
  }
  readInk();
  fit();
  if (reduced()) for (let i = 0; i < 400; i++) sim.step();
  emit();
  addEventListener("resize", fit);
  addEventListener("scroll", redraw, { passive: true });
  addEventListener("pointerdown", onDown);
  addEventListener("pointermove", onMove, { passive: true });
  addEventListener("pointerup", onUp);
  addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", resume);
  document.fonts.ready.then(remask);
  themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  resume();
  draw();
  return true;
}

export function stop() {
  cancelAnimationFrame(raf);
  raf = 0;
  removeEventListener("resize", fit);
  removeEventListener("scroll", redraw);
  removeEventListener("pointerdown", onDown);
  removeEventListener("pointermove", onMove);
  removeEventListener("pointerup", onUp);
  removeEventListener("keydown", onKey);
  document.removeEventListener("visibilitychange", resume);
  themeObserver.disconnect();
  bodyObserver.disconnect();
  sim?.destroy();
  sim = null;
}
