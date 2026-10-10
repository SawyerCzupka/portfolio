import { bestGenomes, injectMigrant, type Genome } from "./evolve";

const HUB_URL: string | undefined = import.meta.env.PUBLIC_LAB_HUB_URL;
const INTERVAL_MS = 30_000;
const FIRST_SYNC_MS = 3_000;
const MAX_BACKOFF_MS = 10 * 60_000;
const TIMEOUT_MS = 8_000;

type WireGenome = Omit<Genome, "weights"> & { fitness: number; weights: number[] };

interface SyncResponse {
  migrants: WireGenome[];
  stats: { contributors: number; poolSize: number; maxGeneration: number };
}

let started = false;

function clientId(): string {
  let id = sessionStorage.getItem("lab-hub-client");
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem("lab-hub-client", id);
  }
  return id;
}

// 6 significant digits keeps two genomes well under the hub's 64 KB body cap.
const toWire = (g: Genome & { fitness: number }): WireGenome => ({
  ...g,
  weights: Array.from(g.weights, (w) => Number(w.toPrecision(6))),
});

/** Syncs genomes with the island hub; `onStatus(null)` means the hub is unreachable. Idempotent. */
export function startHubClient(onStatus: (text: string | null) => void) {
  if (!HUB_URL || started) return;
  started = true;
  const id = clientId();
  let delay = INTERVAL_MS;

  async function tick() {
    if (document.visibilityState === "visible") {
      try {
        const res = await fetch(new URL("/sync", HUB_URL), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: id, genomes: bestGenomes(2).map(toWire) }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(String(res.status));
        const { migrants, stats }: SyncResponse = await res.json();
        for (const m of migrants) injectMigrant({ ...m, weights: Float32Array.from(m.weights) });
        onStatus(`${stats.contributors} browsers contributing · pool ${stats.poolSize}`);
        delay = INTERVAL_MS;
      } catch {
        onStatus(null);
        delay = Math.min(delay * 2, MAX_BACKOFF_MS);
      }
    }
    setTimeout(tick, delay);
  }

  setTimeout(tick, FIRST_SYNC_MS);
}
