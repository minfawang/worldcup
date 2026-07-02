import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { ModelKey } from "./models";
import type { Lang } from "./i18n";

export interface PredictionSource {
  title: string;
  url: string;
}

/** One candidate final scoreline with the probability the model assigns it. */
export interface Scoreline {
  score1: number;
  score2: number;
  /** Probability (0-100) the model assigns to this exact scoreline. */
  confidence: number;
}

export interface PredictionResult {
  matchId: number;
  model: { key: ModelKey; label: string; id: string };
  team1: string;
  team2: string;
  prediction: {
    /** Top scorelines the model considers most likely, sorted by confidence. */
    scorelines: Scoreline[];
    winner: string;
    reasoning: string;
    team1Ranking?: number;
    team2Ranking?: number;
    headToHead?: string;
    keyPlayers1?: string;
    keyPlayers2?: string;
    keyFactors?: string[];
    // Legacy single-scoreline fields kept optional so older cached predictions
    // still read/normalize cleanly into `scorelines`.
    score1?: number;
    score2?: number;
    confidence?: number;
  };
  sources?: PredictionSource[];
}

// Predictions are kept in an in-memory map for fast reads and persisted to a
// durable backend so they survive restarts and are shared across serverless
// instances. The durable backend is Upstash Redis when configured (works on
// Vercel), otherwise a local JSON file for local development. `globalThis`
// keeps state stable across dev hot-reloads.
const globalCache = globalThis as unknown as {
  __wcPredictions?: Map<string, PredictionResult>;
  __wcRedis?: Redis | null;
  __wcFileLoaded?: boolean;
  __wcWriteChain?: Promise<void>;
};

const REDIS_KEY_PREFIX = "wc:prediction:";
const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "predictions.json");

function memory(): Map<string, PredictionResult> {
  if (!globalCache.__wcPredictions) {
    globalCache.__wcPredictions = new Map();
  }
  return globalCache.__wcPredictions;
}

// Lazily construct the Upstash Redis client from env. Returns null when it is
// not configured (e.g. local dev without Upstash), in which case callers fall
// back to the local JSON file. The result is memoized (including the null case).
// Supports both the Upstash-standard variable names and the Vercel KV names
// (`KV_REST_API_*`), since the Vercel integration may inject either pair.
function redis(): Redis | null {
  if (globalCache.__wcRedis !== undefined) return globalCache.__wcRedis;
  const hasUpstash =
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN;
  const hasKv =
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN;
  globalCache.__wcRedis = hasUpstash || hasKv ? Redis.fromEnv() : null;
  return globalCache.__wcRedis;
}

// Read the persisted predictions once into memory on cold start (file backend
// only). Any parse/IO error is treated as an empty cache rather than crashing.
function ensureFileLoaded(map: Map<string, PredictionResult>): void {
  if (globalCache.__wcFileLoaded) return;
  globalCache.__wcFileLoaded = true;
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw) as Record<string, PredictionResult>;
    for (const [key, value] of Object.entries(parsed)) {
      map.set(key, value);
    }
  } catch {
    // No file yet (or unreadable): start with an empty cache.
  }
}

// Persist the whole cache atomically (write temp file, then rename) so a crash
// mid-write can't corrupt the JSON. Writes are chained to avoid interleaving.
function persistToDisk(map: Map<string, PredictionResult>): void {
  const snapshot = Object.fromEntries(map);
  const prev = globalCache.__wcWriteChain ?? Promise.resolve();
  globalCache.__wcWriteChain = prev
    .then(async () => {
      await fs.promises.mkdir(DATA_DIR, { recursive: true });
      const tmp = `${DATA_FILE}.${process.pid}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(snapshot, null, 2), "utf8");
      await fs.promises.rename(tmp, DATA_FILE);
    })
    .catch((err) => {
      console.error("Failed to persist prediction cache:", err);
    });
}

function keyFor(matchId: number, model: ModelKey, lang: Lang): string {
  return `${matchId}:${model}:${lang}`;
}

// The model occasionally returns keyFactors as a single string instead of an
// array, and sometimes packs several factors into one string using <item>...
// </item> tags. Normalize any of these shapes into a clean string[] so the UI
// always renders one bullet per factor. Applied on both write and read so
// previously cached (mis-shaped) predictions are repaired on display too.
export function normalizeKeyFactors(raw: unknown): string[] | undefined {
  const source = Array.isArray(raw)
    ? raw.filter((f): f is string => typeof f === "string")
    : typeof raw === "string"
      ? [raw]
      : [];

  const factors: string[] = [];
  for (const entry of source) {
    const matches = [...entry.matchAll(/<item>([\s\S]*?)<\/item>/gi)];
    if (matches.length > 0) {
      for (const m of matches) {
        const text = m[1].trim();
        if (text) factors.push(text);
      }
    } else {
      // No wrapping tags: strip any stray tags and keep the plain text.
      const text = entry.replace(/<\/?item>/gi, "").trim();
      if (text) factors.push(text);
    }
  }

  return factors.length > 0 ? factors : undefined;
}

// Coerce whatever the model (or an older cached record) produced into a clean,
// sorted list of at most three scorelines. Falls back to the legacy single
// score fields so predictions cached before the multi-scoreline change keep
// rendering. Returns an empty array only when nothing usable is present.
export function normalizeScorelines(
  raw: unknown,
  legacy?: { score1?: number; score2?: number; confidence?: number },
): Scoreline[] {
  const clampScore = (n: unknown): number | null => {
    const v = Math.trunc(Number(n));
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  const clampConf = (n: unknown): number => {
    const v = Math.round(Number(n));
    if (!Number.isFinite(v)) return 0;
    return Math.min(100, Math.max(0, v));
  };

  const list: Scoreline[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const s1 = clampScore((item as { score1?: unknown }).score1);
      const s2 = clampScore((item as { score2?: unknown }).score2);
      if (s1 === null || s2 === null) continue;
      list.push({
        score1: s1,
        score2: s2,
        confidence: clampConf((item as { confidence?: unknown }).confidence),
      });
    }
  }

  // Fall back to the legacy single-scoreline shape when no array was provided.
  if (list.length === 0 && legacy) {
    const s1 = clampScore(legacy.score1);
    const s2 = clampScore(legacy.score2);
    if (s1 !== null && s2 !== null) {
      list.push({ score1: s1, score2: s2, confidence: clampConf(legacy.confidence) });
    }
  }

  // De-duplicate identical scorelines, keeping the highest confidence.
  const byKey = new Map<string, Scoreline>();
  for (const s of list) {
    const key = `${s.score1}-${s.score2}`;
    const existing = byKey.get(key);
    if (!existing || s.confidence > existing.confidence) byKey.set(key, s);
  }

  return [...byKey.values()]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
}

// Claude's web_search sometimes wraps sentences in citation markup like
// <cite index="12-5">...</cite>. Strip the tags (keeping the inner text) so the
// UI shows clean prose. Applied to every free-text field on write and read.
export function stripCitations(text: string | undefined): string | undefined {
  if (typeof text !== "string") return text;
  const cleaned = text
    .replace(/<\/?cite\b[^>]*>/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

// Apply keyFactors + scorelines normalization and citation stripping to a
// stored/loaded prediction, returning a new object safe for the UI to render.
function normalizePrediction(result: PredictionResult): PredictionResult {
  const keyFactors = (normalizeKeyFactors(result.prediction?.keyFactors) ?? [])
    .map((f) => stripCitations(f))
    .filter((f): f is string => Boolean(f));
  const scorelines = normalizeScorelines(result.prediction?.scorelines, {
    score1: result.prediction?.score1,
    score2: result.prediction?.score2,
    confidence: result.prediction?.confidence,
  });
  return {
    ...result,
    prediction: {
      ...result.prediction,
      reasoning: stripCitations(result.prediction?.reasoning) ?? "",
      headToHead: stripCitations(result.prediction?.headToHead),
      keyPlayers1: stripCitations(result.prediction?.keyPlayers1),
      keyPlayers2: stripCitations(result.prediction?.keyPlayers2),
      keyFactors: keyFactors.length > 0 ? keyFactors : undefined,
      scorelines,
    },
  };
}

export async function getPrediction(
  matchId: number,
  model: ModelKey,
  lang: Lang,
): Promise<PredictionResult | undefined> {
  const key = keyFor(matchId, model, lang);
  const map = memory();
  if (map.has(key)) return map.get(key);

  const client = redis();
  if (client) {
    try {
      // @upstash/redis serializes/deserializes JSON automatically.
      const value = await client.get<PredictionResult>(REDIS_KEY_PREFIX + key);
      if (value) {
        const normalized = normalizePrediction(value);
        map.set(key, normalized);
        return normalized;
      }
    } catch (err) {
      console.error("Failed to read prediction from Redis:", err);
    }
    return undefined;
  }

  ensureFileLoaded(map);
  const local = map.get(key);
  return local ? normalizePrediction(local) : undefined;
}

export async function setPrediction(
  matchId: number,
  model: ModelKey,
  lang: Lang,
  result: PredictionResult,
): Promise<void> {
  const key = keyFor(matchId, model, lang);
  const map = memory();
  const normalized = normalizePrediction(result);
  result = normalized;
  map.set(key, normalized);

  const client = redis();
  if (client) {
    try {
      await client.set(REDIS_KEY_PREFIX + key, result);
    } catch (err) {
      console.error("Failed to persist prediction to Redis:", err);
    }
    return;
  }

  persistToDisk(map);
}
