"use client";

import { useState } from "react";
import type { WCMatch } from "@/lib/worldcup";
import { MODEL_LIST, type ModelKey } from "@/lib/models";
import { flagFor } from "@/lib/flags";
import { useLanguage } from "@/components/LanguageProvider";

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
  const { t, lang, team, round, group } = useLanguage();
  const [model, setModel] = useState<ModelKey>("sonnet");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep results per model + language so toggling reuses what we already have.
  const [results, setResults] = useState<Record<string, PredictResponse>>({});

  const resultKey = `${model}:${lang}`;
  const result = results[resultKey] ?? null;

  const modelDesc: Record<ModelKey, string> = {
    sonnet: t("sonnetDesc"),
    opus: t("opusDesc"),
  };

  async function runPrediction() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id, model, lang }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Prediction failed.");
      }
      setResults((prev) => ({ ...prev, [resultKey]: data as PredictResponse }));
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="glass-strong w-full max-w-lg animate-scale-in overflow-hidden rounded-3xl shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative border-b border-white/5 bg-white/[0.02] p-6">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pitch-400/60 to-transparent" />
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-pitch-300">
                {match.stage === "group" ? group(match.group) : round(match.round)}
              </p>
              <h2 className="mt-2 flex flex-wrap items-center gap-x-2 text-xl font-semibold text-white">
                <span className="whitespace-nowrap">
                  {flagFor(match.team1)} {team(match.team1)}
                </span>
                <span className="text-sm font-light text-slate-500">{t("vs")}</span>
                <span className="whitespace-nowrap">
                  {flagFor(match.team2)} {team(match.team2)}
                </span>
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="p-6">
          <div className="mb-5">
            <p className="mb-2.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
              {t("model")}
            </p>
            <div className="grid grid-cols-2 gap-3">
              {MODEL_LIST.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => selectModel(m.key)}
                  disabled={loading}
                  className={`rounded-2xl border p-3.5 text-left transition disabled:opacity-60 ${
                    model === m.key
                      ? "border-pitch-400/60 bg-pitch-400/[0.08] shadow-glow"
                      : "border-white/10 bg-white/[0.03] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        model === m.key ? "bg-pitch-400" : "bg-white/20"
                      }`}
                    />
                    {m.label}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">{modelDesc[m.key]}</div>
                </button>
              ))}
            </div>
          </div>

          {!result && (
            <button
              type="button"
              onClick={runPrediction}
              disabled={loading}
              className="w-full rounded-2xl bg-brand-gradient px-4 py-3 font-semibold text-slate-950 shadow-glow transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <span className="animate-spin">↻</span> {t("predicting")}
                </span>
              ) : (
                t("predictBtn")
              )}
            </button>
          )}

          {result?.cached && (
            <p className="text-center text-[11px] text-slate-500">{t("savedNote")}</p>
          )}

          {error && (
            <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </p>
          )}

          {result && (
            <div className="mt-5 space-y-5 animate-fade-in-up">
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <div className="flex items-center justify-center gap-5 text-center">
                  <div className="flex-1">
                    <div className="text-3xl">{flagFor(result.team1)}</div>
                    <div className="mt-1 truncate text-xs text-slate-400">{team(result.team1)}</div>
                  </div>
                  <div className="text-4xl font-bold tabular-nums text-white">
                    <span className="text-gradient">{result.prediction.score1}</span>
                    <span className="mx-2 text-slate-600">-</span>
                    <span className="text-gradient">{result.prediction.score2}</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-3xl">{flagFor(result.team2)}</div>
                    <div className="mt-1 truncate text-xs text-slate-400">{team(result.team2)}</div>
                  </div>
                </div>
                <p className="mt-4 text-center text-sm">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-pitch-400/25 bg-pitch-400/10 px-3 py-1 text-pitch-300">
                    {result.prediction.winner === "Draw"
                      ? t("drawText")
                      : `${t("winnerPrefix")}${team(result.prediction.winner)}`}
                  </span>
                </p>
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-400">
                  <span className="uppercase tracking-[0.15em]">{t("confidence")}</span>
                  <span className="tabular-nums text-slate-200">
                    {result.prediction.confidence}%
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-white/5">
                  <div
                    className="h-full rounded-full bg-brand-gradient transition-all duration-700"
                    style={{
                      width: `${Math.min(100, Math.max(0, result.prediction.confidence))}%`,
                    }}
                  />
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
                  {t("reasoning")}
                </p>
                <p className="text-sm leading-relaxed text-slate-200">
                  {result.prediction.reasoning}
                </p>
              </div>

              <p className="text-right text-[11px] text-slate-500">
                {t("viaPrefix")}
                {result.model.label} ({result.model.id})
                {t("viaSuffix")}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
