import fs from "node:fs";
import path from "node:path";
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

// Predictions are cached in memory for fast reads and persisted to disk so they
// survive server restarts. `globalThis` keeps state stable across dev
// hot-reloads. The on-disk file is the source of truth on cold start.
const globalCache = globalThis as unknown as {
  __wcPredictions?: Map<string, PredictionResult>;
  __wcPredictionsLoaded?: boolean;
  __wcPredictionsWriteChain?: Promise<void>;
};

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "predictions.json");

function store(): Map<string, PredictionResult> {
  if (!globalCache.__wcPredictions) {
    globalCache.__wcPredictions = new Map();
  }
  if (!globalCache.__wcPredictionsLoaded) {
    loadFromDisk(globalCache.__wcPredictions);
    globalCache.__wcPredictionsLoaded = true;
  }
  return globalCache.__wcPredictions;
}

// Read the persisted predictions once on cold start. Any parse/IO error is
// treated as an empty cache rather than crashing the route.
function loadFromDisk(map: Map<string, PredictionResult>): void {
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
  const prev = globalCache.__wcPredictionsWriteChain ?? Promise.resolve();
  globalCache.__wcPredictionsWriteChain = prev
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

export function getPrediction(
  matchId: number,
  model: ModelKey,
  lang: Lang,
): PredictionResult | undefined {
  return store().get(keyFor(matchId, model, lang));
}

export function setPrediction(
  matchId: number,
  model: ModelKey,
  lang: Lang,
  result: PredictionResult,
): void {
  const map = store();
  map.set(keyFor(matchId, model, lang), result);
  persistToDisk(map);
}
