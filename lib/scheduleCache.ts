import { fetchSchedule, type Schedule } from "./worldcup";

interface CacheEntry {
  fetchedAt: string;
  schedule: Schedule;
}

// Cache lives for the lifetime of the server process. `globalThis` keeps it
// stable across hot-reloads in development.
//
// NOTE: these keys must be unique across the whole app. `predictionCache.ts`
// also stores state on `globalThis`; using a schedule-specific inflight key
// (rather than a shared `__wcInflight`) avoids a collision where a prediction's
// in-flight Map would be mistaken for the schedule-loading promise and returned
// from `getSchedule`, yielding an object with no `schedule`/`fetchedAt`.
const globalCache = globalThis as unknown as {
  __wcScheduleCache?: CacheEntry | null;
  __wcScheduleInflight?: Promise<CacheEntry> | null;
};

const TTL_MS = 5 * 60 * 1000; // 5 minutes

async function load(): Promise<CacheEntry> {
  const schedule = await fetchSchedule();
  const entry: CacheEntry = { fetchedAt: new Date().toISOString(), schedule };
  globalCache.__wcScheduleCache = entry;
  return entry;
}

export async function getSchedule(force = false): Promise<CacheEntry> {
  const cached = globalCache.__wcScheduleCache;
  const isFresh =
    cached && Date.now() - Date.parse(cached.fetchedAt) < TTL_MS;

  if (!force && cached && isFresh) {
    return cached;
  }

  // De-dupe concurrent refreshes.
  if (globalCache.__wcScheduleInflight) {
    return globalCache.__wcScheduleInflight;
  }

  const inflight = load().finally(() => {
    globalCache.__wcScheduleInflight = null;
  });
  globalCache.__wcScheduleInflight = inflight;
  return inflight;
}
