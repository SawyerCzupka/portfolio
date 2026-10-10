// Population and evolution for the lab NCA. Genomes are slot-independent: the
// shader rotates channels so a net always sees its own species first.

export const K = 4;
export const CHANNELS = 8;
export const PERCEPTS = CHANNELS * 3;
export const HIDDEN = 32;
// W1 [HIDDEN][PERCEPTS], b1 [HIDDEN], W2 [CHANNELS][HIDDEN], b2 [CHANNELS]
export const GENOME_LEN = HIDDEN * PERCEPTS + HIDDEN + CHANNELS * HIDDEN + CHANNELS;
const W1_END = HIDDEN * PERCEPTS;
const B1_END = W1_END + HIDDEN;
const W2_END = B1_END + CHANNELS * HIDDEN;

export type Genome = { id: string; parent: string | null; generation: number; weights: Float32Array };
export type Species = {
  genome: Genome;
  born: number;
  bornEpoch: number;
  share: number;
  fitness: number;
  samples: number;
};

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const hexId = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");

function randomWeights(): Float32Array {
  const w = new Float32Array(GENOME_LEN);
  for (let i = 0; i < GENOME_LEN; i++) {
    w[i] = i < W1_END ? gauss() * 0.35 : i < B1_END ? gauss() * 0.1 : i < W2_END ? gauss() * 0.25 : 0;
  }
  return w;
}

const jitter = (w: Float32Array, sigma: number) =>
  w.map((v) => v + gauss() * (Math.random() < 0.02 ? sigma * 6 : sigma));

export function mutate(g: Genome): Genome {
  return { id: hexId(), parent: g.id, generation: g.generation + 1, weights: jitter(g.weights, 0.06) };
}

export function crossover(a: Genome, b: Genome): Genome {
  const cut = Math.floor(Math.random() * GENOME_LEN);
  const w = new Float32Array(GENOME_LEN);
  w.set(a.weights.subarray(0, cut));
  w.set(b.weights.subarray(cut), cut);
  return { id: hexId(), parent: a.id, generation: Math.max(a.generation, b.generation) + 1, weights: jitter(w, 0.03) };
}

export const population: Species[] = Array.from({ length: K }, () => ({
  genome: { id: hexId(), parent: null, generation: 0, weights: randomWeights() },
  born: Date.now(),
  bornEpoch: -1,
  share: 1 / K,
  fitness: 1 / K,
  samples: 0,
}));

let migrant: Genome | null = null;
export let epoch = 0;

/** Feed per-species territory shares sampled between evolution ticks. */
export function observe(shares: ArrayLike<number>) {
  population.forEach((s, i) => {
    s.share = shares[i];
    s.fitness = (s.fitness * s.samples + shares[i]) / ++s.samples;
  });
}

export function bestGenomes(n: number): (Genome & { fitness: number })[] {
  return [...population]
    .sort((a, b) => b.fitness - a.fitness)
    .slice(0, n)
    .map((s) => ({ ...s.genome, fitness: s.fitness }));
}

/** Queue g to replace the weakest species on the next evolution tick. */
export function injectMigrant(g: Genome) {
  if (g.weights.length !== GENOME_LEN) throw new Error(`genome must have ${GENOME_LEN} weights`);
  migrant = g;
}

/** Replace the weakest species; returns the slot that needs reseeding. */
export function evolve(): number {
  const ranked = population.map((s, i) => ({ s, i })).sort((a, b) => b.s.fitness - a.s.fitness);
  // Newcomers get two epochs of grace unless already extinct; otherwise a small
  // fresh seed is always the weakest and incumbents are never challenged.
  const eligible = ranked.filter(({ s }) => s.share === 0 || epoch - s.bornEpoch >= 2);
  const weakest = (eligible.length ? eligible : ranked).at(-1)!.i;
  const [a, b] = ranked.filter(({ i }) => i !== weakest).map(({ s }) => s.genome);
  const genome = migrant ?? (Math.random() < 0.3 ? crossover(a, b) : mutate(a));
  migrant = null;
  population.forEach((s) => ((s.fitness = s.share), (s.samples = 0)));
  epoch++;
  population[weakest] = { genome, born: Date.now(), bornEpoch: epoch, share: 0, fitness: 0, samples: 0 };
  return weakest;
}
