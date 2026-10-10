import { DurableObject } from "cloudflare:workers";

// Must match GENOME_LEN in src/lib/lab/evolve.ts (the source of truth).
const GENOME_LEN = 1064;
const MAX_BODY = 64 * 1024;
const MAX_GENOMES = 2;
const MAX_ABS_WEIGHT = 100;
const POOL_CAP = 200;
const CONTRIBUTOR_WINDOW_MS = 2 * 60_000;
const SYNC_INTERVAL_MS = 10_000;

const ALLOWED_ORIGINS = new Set([
  "https://sawyerczupka.com",
  "https://www.sawyerczupka.com",
  "http://localhost:4321",
]);

interface Genome {
  id: string;
  parent: string | null;
  generation: number;
  fitness: number;
  weights: number[];
}

interface Stats {
  contributors: number;
  poolSize: number;
  maxGeneration: number;
}

interface Env {
  HUB: DurableObjectNamespace<GenomeHub>;
}

export class GenomeHub extends DurableObject<Env> {
  private lastSync = new Map<string, number>();
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS genomes (
        client_id TEXT NOT NULL,
        id TEXT NOT NULL,
        parent TEXT,
        generation INTEGER NOT NULL,
        fitness REAL NOT NULL,
        weights BLOB NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (client_id, id)
      );
      CREATE TABLE IF NOT EXISTS clients (
        client_id TEXT PRIMARY KEY,
        last_seen INTEGER NOT NULL
      );
    `);
    // Clients reject migrants of the wrong shape, so a GENOME_LEN change must drop the old pool.
    this.sql.exec("DELETE FROM genomes WHERE length(weights) != ?", GENOME_LEN * 4);
  }

  sync(clientId: string, genomes: Genome[]): { migrants: Genome[]; stats: Stats } | null {
    const now = Date.now();
    if (now - (this.lastSync.get(clientId) ?? 0) < SYNC_INTERVAL_MS) return null;
    this.lastSync.set(clientId, now);
    for (const [id, t] of this.lastSync) if (now - t > SYNC_INTERVAL_MS) this.lastSync.delete(id);

    this.sql.exec(
      "INSERT OR REPLACE INTO clients (client_id, last_seen) VALUES (?, ?)",
      clientId,
      now,
    );
    for (const g of genomes) {
      this.sql.exec(
        "INSERT OR REPLACE INTO genomes VALUES (?, ?, ?, ?, ?, ?, ?)",
        clientId,
        g.id,
        g.parent,
        g.generation,
        g.fitness,
        new Float32Array(g.weights).buffer,
        now,
      );
    }
    // Rank-based so the score doesn't depend on the fitness scale; recency lets new lineages survive.
    this.sql.exec(
      `DELETE FROM genomes WHERE rowid NOT IN (
         SELECT rowid FROM genomes ORDER BY
           PERCENT_RANK() OVER (ORDER BY fitness) + 0.5 * PERCENT_RANK() OVER (ORDER BY created_at) DESC
         LIMIT ?)`,
      POOL_CAP,
    );

    const migrants = this.sql
      .exec<{ id: string; parent: string | null; generation: number; fitness: number; weights: ArrayBuffer }>(
        `SELECT id, parent, generation, fitness, weights FROM (
           SELECT * FROM genomes WHERE client_id != ? ORDER BY fitness DESC LIMIT 50
         ) ORDER BY RANDOM() LIMIT ?`,
        clientId,
        MAX_GENOMES,
      )
      .toArray()
      .map((r) => ({ ...r, weights: Array.from(new Float32Array(r.weights), (w) => Number(w.toPrecision(7))) }));
    return { migrants, stats: this.stats() };
  }

  stats(): Stats {
    const now = Date.now();
    this.sql.exec("DELETE FROM clients WHERE last_seen < ?", now - CONTRIBUTOR_WINDOW_MS);
    const row = this.sql
      .exec<{ contributors: number; poolSize: number; maxGeneration: number }>(
        `SELECT (SELECT COUNT(*) FROM clients) AS contributors,
                COUNT(*) AS poolSize,
                COALESCE(MAX(generation), 0) AS maxGeneration
         FROM genomes`,
      )
      .one();
    return row;
  }
}

const HEX_ID = /^[0-9a-f]{1,32}$/;
const CLIENT_ID = /^[A-Za-z0-9_-]{8,64}$/;

function parseSync(body: unknown): { clientId: string; genomes: Genome[] } | null {
  if (typeof body !== "object" || body === null) return null;
  const { clientId, genomes } = body as Record<string, unknown>;
  if (typeof clientId !== "string" || !CLIENT_ID.test(clientId)) return null;
  if (!Array.isArray(genomes) || genomes.length > MAX_GENOMES) return null;
  const out: Genome[] = [];
  for (const g of genomes) {
    if (typeof g !== "object" || g === null) return null;
    const { id, parent, generation, fitness, weights } = g as Record<string, unknown>;
    if (typeof id !== "string" || !HEX_ID.test(id)) return null;
    if (parent != null && (typeof parent !== "string" || !HEX_ID.test(parent))) return null;
    if (!Number.isSafeInteger(generation) || (generation as number) < 0) return null;
    if (typeof fitness !== "number" || !Number.isFinite(fitness)) return null;
    if (!Array.isArray(weights) || weights.length !== GENOME_LEN) return null;
    if (!weights.every((w) => typeof w === "number" && Math.abs(w) <= MAX_ABS_WEIGHT)) return null;
    out.push({ id, parent: parent ?? null, generation: generation as number, fitness, weights });
  }
  return { clientId, genomes: out };
}

function corsOrigin(origin: string | null): string | null {
  if (!origin) return null;
  if (ALLOWED_ORIGINS.has(origin)) return origin;
  try {
    const url = new URL(origin);
    const labels = url.hostname.split(".");
    if (
      url.protocol === "https:" &&
      labels.length === 4 &&
      labels[0].endsWith("sawyer-czupka-portfolio") &&
      url.hostname.endsWith(".workers.dev")
    ) {
      return origin;
    }
  } catch {}
  return null;
}

export default {
  async fetch(request, env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const allowed = corsOrigin(origin);
    if (origin && !allowed) return new Response("forbidden origin", { status: 403 });
    const cors: Record<string, string> = allowed
      ? {
          "Access-Control-Allow-Origin": allowed,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
          Vary: "Origin",
        }
      : {};
    const json = (data: unknown, status = 200) =>
      Response.json(data, { status, headers: cors });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const hub = env.HUB.get(env.HUB.idFromName("world"));
    const { pathname } = new URL(request.url);

    if (pathname === "/stats" && request.method === "GET") return json(await hub.stats());

    if (pathname === "/sync" && request.method === "POST") {
      if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY) {
        return json({ error: "body too large" }, 400);
      }
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "body too large" }, 400);
      let parsed;
      try {
        parsed = parseSync(JSON.parse(text));
      } catch {
        parsed = null;
      }
      if (!parsed) return json({ error: "invalid body" }, 400);
      const result = await hub.sync(parsed.clientId, parsed.genomes);
      return result ? json(result) : json({ error: "rate limited" }, 429);
    }

    return json({ error: "not found" }, 404);
  },
} satisfies ExportedHandler<Env>;
