"use client";

import { useState } from "react";
import type { WCMatch } from "@/lib/worldcup";
import { MODEL_LIST, type ModelKey } from "@/lib/models";
import { flagFor } from "@/lib/flags";

interface Prediction {
  score1: number;
  score2: number;
  winner: string;
  confidence: number;
  reasoning: string;
}

interface PredictResponse {
  model: { key: ModelKey; label: string; id: string };
  team1: string;
  team2: string;
  prediction: Prediction;
  cached?: boolean;
}

interface PredictPanelProps {
  match: WCMatch;
  onClose: () => void;
}

export default function PredictPanel({ match, onClose }: PredictPanelProps) {
  const [model, setModel] = useState<ModelKey>("sonnet");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep results per model so toggling between them reuses what we already have.
  const [results, setResults] = useState<Partial<Record<ModelKey, PredictResponse>>>({});

  const result = results[model] ?? null;

  async function runPrediction() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id, model }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Prediction failed.");
      }
      setResults((prev) => ({ ...prev, [model]: data as PredictResponse }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed.");
    } finally {
      setLoading(false);
    }
  }

  function selectModel(next: ModelKey) {
    setModel(next);
    setError(null);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">
              {match.stage === "group" ? match.group : match.round}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              {flagFor(match.team1)} {match.team1}
              <span className="mx-2 text-slate-500">vs</span>
              {flagFor(match.team2)} {match.team2}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mb-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">
            Model
          </p>
          <div className="grid grid-cols-2 gap-2">
            {MODEL_LIST.map((m) => (
              <button
                key={m.key}
                type="button"
                onClick={() => selectModel(m.key)}
                disabled={loading}
                className={`rounded-xl border p-3 text-left transition disabled:opacity-60 ${
                  model === m.key
                    ? "border-pitch-500 bg-pitch-500/10 ring-1 ring-pitch-500"
                    : "border-slate-800 bg-slate-800/40 hover:border-slate-600"
                }`}
              >
                <div className="text-sm font-semibold text-white">{m.label}</div>
                <div className="text-xs text-slate-400">{m.description}</div>
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={runPrediction}
          disabled={loading}
          className="w-full rounded-xl bg-pitch-600 px-4 py-2.5 font-semibold text-white transition hover:bg-pitch-500 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {loading ? "Predicting…" : result ? "Predict again" : "预测 / Predict result"}
        </button>

        {result?.cached && (
          <p className="mt-2 text-center text-[11px] text-slate-500">
            Showing a cached prediction for this match &amp; model.
          </p>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
            {error}
          </p>
        )}

        {result && (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-800/40 p-4">
              <div className="flex items-center justify-center gap-4 text-center">
                <div className="flex-1">
                  <div className="text-2xl">{flagFor(result.team1)}</div>
                  <div className="truncate text-xs text-slate-300">{result.team1}</div>
                </div>
                <div className="text-3xl font-bold tabular-nums text-white">
                  {result.prediction.score1}
                  <span className="mx-2 text-slate-500">-</span>
                  {result.prediction.score2}
                </div>
                <div className="flex-1">
                  <div className="text-2xl">{flagFor(result.team2)}</div>
                  <div className="truncate text-xs text-slate-300">{result.team2}</div>
                </div>
              </div>
              <p className="mt-3 text-center text-sm text-pitch-500">
                {result.prediction.winner === "Draw"
                  ? "Predicted draw"
                  : `Predicted winner: ${result.prediction.winner}`}
              </p>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
                <span>Confidence</span>
                <span className="tabular-nums">{result.prediction.confidence}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-pitch-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(0, result.prediction.confidence))}%` }}
                />
              </div>
            </div>

            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Reasoning
              </p>
              <p className="text-sm leading-relaxed text-slate-200">
                {result.prediction.reasoning}
              </p>
            </div>

            <p className="text-right text-[11px] text-slate-500">
              via {result.model.label} ({result.model.id})
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
