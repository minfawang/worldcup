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
  store().set(keyFor(matchId, model, lang), result);
}
