import { fetchSchedule, type Schedule } from "./worldcup";

interface CacheEntry {
  fetchedAt: string;
  schedule: Schedule;
}

// Cache lives for the lifetime of the server process. `globalThis` keeps it
// stable across hot-reloads in development.
const globalCache = globalThis as unknown as {
  __wcCache?: CacheEntry | null;
  __wcInflight?: Promise<CacheEntry> | null;
};

const TTL_MS = 5 * 60 * 1000; // 5 minutes

async function load(): Promise<CacheEntry> {
  const schedule = await fetchSchedule();
  const entry: CacheEntry = { fetchedAt: new Date().toISOString(), schedule };
  globalCache.__wcCache = entry;
  return entry;
}

export async function getSchedule(force = false): Promise<CacheEntry> {
  const cached = globalCache.__wcCache;
  const isFresh =
    cached && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS;

  if (!force && cached && isFresh) {
    return cached;
  }

  // De-dupe concurrent refreshes.
  if (globalCache.__wcInflight) {
    return globalCache.__wcInflight;
  }

  const inflight = load().finally(() => {
    globalCache.__wcInflight = null;
  });
  globalCache.__wcInflight = inflight;
  return inflight;
}
