import type { ModelKey } from "./models";

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
  };
}

// Cache predictions per match + model for the lifetime of the server process.
// `globalThis` keeps the cache stable across dev hot-reloads.
const globalCache = globalThis as unknown as {
  __wcPredictions?: Map<string, PredictionResult>;
};

function store(): Map<string, PredictionResult> {
  if (!globalCache.__wcPredictions) {
    globalCache.__wcPredictions = new Map();
  }
  return globalCache.__wcPredictions;
}

function keyFor(matchId: number, model: ModelKey): string {
  return `${matchId}:${model}`;
}

export function getPrediction(
  matchId: number,
  model: ModelKey,
): PredictionResult | undefined {
  return store().get(keyFor(matchId, model));
}

export function setPrediction(
  matchId: number,
  model: ModelKey,
  result: PredictionResult,
): void {
  store().set(keyFor(matchId, model), result);
}
