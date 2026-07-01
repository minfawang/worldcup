"use client";

import { useEffect, useRef, useState } from "react";
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
  team1Ranking?: number;
  team2Ranking?: number;
  headToHead?: string;
  keyPlayers1?: string;
  keyPlayers2?: string;
  keyFactors?: string[];
}

interface Source {
  title: string;
  url: string;
}

interface PredictResponse {
  model: { key: ModelKey; label: string; id: string };
  team1: string;
  team2: string;
  prediction: Prediction;
  sources?: Source[];
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
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string[]>([]);
  // Keep results per model + language so toggling reuses what we already have.
  const [results, setResults] = useState<Record<string, PredictResponse>>({});

  const resultKey = `${model}:${lang}`;
  const result = results[resultKey] ?? null;

  const resultsRef = useRef(results);
  resultsRef.current = results;

  const modelDesc: Record<ModelKey, string> = {
    sonnet: t("sonnetDesc"),
    opus: t("opusDesc"),
  };

  // Lock background page scroll while the dialog is open so wheel/touch
  // gestures act on the dialog instead of the page behind it.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // On open / model / language change, look up a server-cached prediction and
  // show it directly (no button, no extra Claude call) if one exists.
  useEffect(() => {
    if (resultsRef.current[resultKey]) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    fetch(
      `/api/predict?matchId=${match.id}&model=${model}&lang=${lang}`,
    )
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data?.cached && data?.prediction) {
          setResults((prev) => ({ ...prev, [resultKey]: data as PredictResponse }));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [match.id, model, lang, resultKey]);

  async function runPrediction() {
    setLoading(true);
    setError(null);
    setProgress([]);
    const addStep = (msg: string) => setProgress((prev) => [...prev, msg]);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id, model, lang }),
      });
      const contentType = res.headers.get("content-type") ?? "";

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Prediction failed.");
      }

      // Cached predictions come back as a single JSON payload.
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as PredictResponse;
        setResults((prev) => ({ ...prev, [resultKey]: data }));
        return;
      }

      // Live predictions stream newline-delimited JSON progress events.
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Prediction failed.");
      const decoder = new TextDecoder();
      let buffer = "";
      let finalResult: PredictResponse | null = null;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as {
            type: string;
            stage?: string;
            query?: string;
            error?: string;
            result?: PredictResponse;
          };
          if (event.type === "status") {
            if (event.stage === "researching") addStep(t("stepResearching"));
            else if (event.stage === "finalizing") addStep(t("stepFinalizing"));
          } else if (event.type === "search" && event.query) {
            addStep(`${t("stepSearching")}${event.query}`);
          } else if (event.type === "result" && event.result) {
            finalResult = event.result;
          } else if (event.type === "error") {
            throw new Error(event.error ?? "Prediction failed.");
          }
        }
      }

      if (!finalResult) throw new Error("Prediction failed.");
      setResults((prev) => ({ ...prev, [resultKey]: finalResult as PredictResponse }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Prediction failed.");
    } finally {
      setLoading(false);
      setProgress([]);
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
        className="glass-strong flex max-h-[calc(100dvh-2rem)] w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-3xl shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative shrink-0 border-b border-white/5 bg-white/[0.02] p-6">
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

        <div className="thin-scroll scroll-fade-y flex-1 overflow-y-auto overscroll-contain p-6">
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

          {!result && checking && (
            <div className="flex items-center justify-center py-3 text-slate-400">
              <span className="animate-spin text-pitch-400">↻</span>
            </div>
          )}

          {!result && !checking && (
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

          {!result && loading && progress.length > 0 && (
            <ul className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              {progress.map((step, i) => {
                const isLast = i === progress.length - 1;
                return (
                  <li
                    key={i}
                    className="flex items-start gap-2.5 text-xs leading-relaxed animate-fade-in-up"
                  >
                    <span
                      className={
                        isLast
                          ? "mt-px animate-spin text-pitch-400"
                          : "mt-px text-pitch-400"
                      }
                    >
                      {isLast ? "↻" : "✓"}
                    </span>
                    <span className={isLast ? "text-slate-200" : "text-slate-400"}>
                      {step}
                    </span>
                  </li>
                );
              })}
            </ul>
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
                    {typeof result.prediction.team1Ranking === "number" && (
                      <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-pitch-300">
                        {t("rankLabel")} #{result.prediction.team1Ranking}
                      </div>
                    )}
                  </div>
                  <div className="text-4xl font-bold tabular-nums text-white">
                    <span className="text-gradient">{result.prediction.score1}</span>
                    <span className="mx-2 text-slate-600">-</span>
                    <span className="text-gradient">{result.prediction.score2}</span>
                  </div>
                  <div className="flex-1">
                    <div className="text-3xl">{flagFor(result.team2)}</div>
                    <div className="mt-1 truncate text-xs text-slate-400">{team(result.team2)}</div>
                    {typeof result.prediction.team2Ranking === "number" && (
                      <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-pitch-300">
                        {t("rankLabel")} #{result.prediction.team2Ranking}
                      </div>
                    )}
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

              {Array.isArray(result.prediction.keyFactors) &&
                result.prediction.keyFactors.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
                    {t("keyFactorsLabel")}
                  </p>
                  <ul className="space-y-1.5">
                    {result.prediction.keyFactors.map((factor, i) => (
                      <li
                        key={i}
                        className="flex gap-2 text-sm leading-relaxed text-slate-200"
                      >
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pitch-400" />
                        <span>{factor}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {result.prediction.headToHead && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
                    {t("h2hLabel")}
                  </p>
                  <p className="text-sm leading-relaxed text-slate-200">
                    {result.prediction.headToHead}
                  </p>
                </div>
              )}

              {(result.prediction.keyPlayers1 || result.prediction.keyPlayers2) && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
                    {t("squadLabel")}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {result.prediction.keyPlayers1 && (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-1 text-xs font-semibold text-white">
                          {flagFor(result.team1)} {team(result.team1)}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-300">
                          {result.prediction.keyPlayers1}
                        </p>
                      </div>
                    )}
                    {result.prediction.keyPlayers2 && (
                      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                        <div className="mb-1 text-xs font-semibold text-white">
                          {flagFor(result.team2)} {team(result.team2)}
                        </div>
                        <p className="text-xs leading-relaxed text-slate-300">
                          {result.prediction.keyPlayers2}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
                  {t("reasoning")}
                </p>
                <p className="text-sm leading-relaxed text-slate-200">
                  {result.prediction.reasoning}
                </p>
              </div>

              {result.sources && result.sources.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
                    {t("sourcesLabel")}
                  </p>
                  <ul className="space-y-1">
                    {result.sources.map((src, i) => (
                      <li key={i} className="truncate text-xs">
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-pitch-300 underline decoration-pitch-400/40 underline-offset-2 transition hover:text-pitch-200"
                        >
                          {src.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

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
