import fs from "node:fs";
import path from "node:path";
import { Redis } from "@upstash/redis";
import type { ModelKey } from "./models";
import type { Lang } from "./i18n";

export interface PredictionSource {
  title: string;
  url: string;
}

export interface PredictionResult {
  matchId: number;
  model: { key: ModelKey; label: string; id: string };
  team1: string;
  team2: string;
  prediction: {
    score1: number;
    score2: number;
    winner: string;
    confidence: number;
    reasoning: string;
    team1Ranking?: number;
    team2Ranking?: number;
    headToHead?: string;
    keyPlayers1?: string;
    keyPlayers2?: string;
    keyFactors?: string[];
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
        map.set(key, value);
        return value;
      }
    } catch (err) {
      console.error("Failed to read prediction from Redis:", err);
    }
    return undefined;
  }

  ensureFileLoaded(map);
  return map.get(key);
}

export async function setPrediction(
  matchId: number,
  model: ModelKey,
  lang: Lang,
  result: PredictionResult,
): Promise<void> {
  const key = keyFor(matchId, model, lang);
  const map = memory();
  map.set(key, result);

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
