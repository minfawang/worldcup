"use client";

import { useEffect, useRef, useState } from "react";
import type { WCMatch } from "@/lib/worldcup";
import { MODEL_LIST, type ModelKey } from "@/lib/models";
import { flagFor } from "@/lib/flags";
import { useLanguage } from "@/components/LanguageProvider";

type Translate = ReturnType<typeof useLanguage>["t"];

interface Scoreline {
  score1: number;
  score2: number;
  confidence: number;
}

interface Prediction {
  scorelines: Scoreline[];
  winner: string;
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

const MODEL_KEYS: ModelKey[] = MODEL_LIST.map((m) => m.key);

export default function PredictPanel({ match, onClose }: PredictPanelProps) {
  const { t, lang, team, round, group } = useLanguage();
  const [checking, setChecking] = useState(true);
  // Results are kept per model + language so switching language reuses cache.
  const [results, setResults] = useState<Record<string, PredictResponse>>({});
  // Per-model transient state while running all models in parallel.
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [progress, setProgress] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const resultsRef = useRef(results);
  resultsRef.current = results;

  const rKey = (model: ModelKey) => `${model}:${lang}`;

  const anyLoading = MODEL_KEYS.some((k) => loadingModels[k]);
  const missing = MODEL_KEYS.filter((k) => !results[rKey(k)]);
  const started = MODEL_KEYS.some(
    (k) => loadingModels[k] || errors[k] || results[rKey(k)],
  );

  const availableResults = MODEL_KEYS.map((k) => results[rKey(k)]).filter(
    (r): r is PredictResponse => Boolean(r),
  );
  const consensus =
    availableResults.length >= Math.min(2, MODEL_KEYS.length)
      ? buildConsensus(availableResults)
      : null;

  // Lock background page scroll while the dialog is open.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  // On open / language change, look up server-cached predictions for every
  // model in parallel and show any that already exist (no Claude call).
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    Promise.all(
      MODEL_KEYS.map(async (model) => {
        const key = `${model}:${lang}`;
        if (resultsRef.current[key]) return;
        try {
          const r = await fetch(
            `/api/predict?matchId=${match.id}&model=${model}&lang=${lang}`,
          );
          const data = await r.json();
          if (!cancelled && data?.cached && data?.prediction) {
            setResults((prev) => ({ ...prev, [key]: data as PredictResponse }));
          }
        } catch {
          // Ignore cache-lookup failures; the user can still run a prediction.
        }
      }),
    ).finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [match.id, lang]);

  async function runModel(model: ModelKey) {
    const key = rKey(model);
    setLoadingModels((prev) => ({ ...prev, [model]: true }));
    setErrors((prev) => ({ ...prev, [model]: null }));
    setProgress((prev) => ({ ...prev, [model]: [] }));
    const addStep = (msg: string) =>
      setProgress((prev) => ({ ...prev, [model]: [...(prev[model] ?? []), msg] }));

    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchId: match.id, model, lang }),
      });
      const contentType = res.headers.get("content-type") ?? "";

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? t("modelFailed"));
      }

      // Cached predictions come back as a single JSON payload.
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as PredictResponse;
        setResults((prev) => ({ ...prev, [key]: data }));
        return;
      }

      // Live predictions stream newline-delimited JSON progress events.
      const reader = res.body?.getReader();
      if (!reader) throw new Error(t("modelFailed"));
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
            throw new Error(event.error ?? t("modelFailed"));
          }
        }
      }

      if (!finalResult) throw new Error(t("modelFailed"));
      setResults((prev) => ({ ...prev, [key]: finalResult as PredictResponse }));
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [model]: err instanceof Error ? err.message : t("modelFailed"),
      }));
    } finally {
      setLoadingModels((prev) => ({ ...prev, [model]: false }));
      setProgress((prev) => ({ ...prev, [model]: [] }));
    }
  }

  function runAll() {
    for (const model of MODEL_KEYS) {
      if (!results[rKey(model)] && !loadingModels[model]) runModel(model);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 backdrop-blur-md sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="glass-strong flex max-h-[92dvh] w-full max-w-2xl animate-slide-up flex-col overflow-hidden rounded-t-3xl shadow-card sm:max-h-[calc(100dvh-2rem)] sm:animate-scale-in sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative shrink-0 border-b border-white/5 bg-white/[0.02] p-5 sm:p-6">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/15 sm:hidden" />
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pitch-400/60 to-transparent" />
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-pitch-300">
                {match.stage === "group" ? group(match.group) : round(match.round)}
              </p>
              <h2 className="mt-2 flex flex-wrap items-center gap-x-2 text-lg font-semibold text-white sm:text-xl">
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
              className="-mr-1.5 -mt-1.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="thin-scroll scroll-fade-y flex-1 overflow-y-auto overscroll-contain px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:px-6 sm:pt-6 sm:pb-6">
          {checking && !started && (
            <div className="flex items-center justify-center py-6 text-slate-400">
              <span className="animate-spin text-pitch-400">↻</span>
            </div>
          )}

          {!checking && !started && (
            <button
              type="button"
              onClick={runAll}
              className="w-full rounded-2xl bg-brand-gradient px-4 py-3.5 font-semibold text-slate-950 shadow-glow transition hover:brightness-110"
            >
              {t("predictBtn")}
            </button>
          )}

          {(started || (!checking && missing.length > 0 && missing.length < MODEL_KEYS.length)) && (
            <div className="space-y-4">
              {anyLoading && (
                <p className="text-center text-xs uppercase tracking-[0.15em] text-slate-500">
                  {t("runningModels")}
                </p>
              )}

              {consensus && (
                <ConsensusCard consensus={consensus} t={t} team={team} />
              )}

              {MODEL_KEYS.map((model) => {
                const modelMeta = MODEL_LIST.find((m) => m.key === model)!;
                const result = results[rKey(model)];
                const steps = progress[model] ?? [];
                const err = errors[model];
                const isLoading = loadingModels[model];

                if (!result && !isLoading && !err) return null;

                return (
                  <ModelPanel
                    key={model}
                    label={modelMeta.label}
                    isLoading={!!isLoading}
                    steps={steps}
                    error={err ?? null}
                    result={result ?? null}
                    onRetry={() => runModel(model)}
                    t={t}
                    team={team}
                  />
                );
              })}

              {/* Offer running any models that weren't started/cached yet. */}
              {!anyLoading && missing.length > 0 && (
                <button
                  type="button"
                  onClick={runAll}
                  className="w-full rounded-2xl border border-pitch-400/40 bg-pitch-400/[0.06] px-4 py-3 text-sm font-semibold text-pitch-200 transition hover:bg-pitch-400/10"
                >
                  {t("predictBtn")}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ConsensusScoreline {
  score1: number;
  score2: number;
  /** Confidence averaged over every available model (missing counts as 0). */
  confidence: number;
  /** How many models included this exact scoreline in their top picks. */
  agreement: number;
}

interface Consensus {
  team1: string;
  team2: string;
  scorelines: ConsensusScoreline[];
  winner: string | null;
  modelCount: number;
}

// Merge each model's top scorelines into a single consensus view: average the
// confidence per unique scoreline across all models (a model that didn't list a
// scoreline contributes 0, so agreement is rewarded), and pick the winner via a
// vote weighted by each model's own top-scoreline confidence.
function buildConsensus(results: PredictResponse[]): Consensus {
  const modelCount = results.length;
  const map = new Map<
    string,
    { score1: number; score2: number; total: number; agreement: number }
  >();
  for (const r of results) {
    for (const s of r.prediction.scorelines ?? []) {
      const key = `${s.score1}-${s.score2}`;
      const e =
        map.get(key) ?? { score1: s.score1, score2: s.score2, total: 0, agreement: 0 };
      e.total += s.confidence;
      e.agreement += 1;
      map.set(key, e);
    }
  }

  const scorelines = [...map.values()]
    .map((e) => ({
      score1: e.score1,
      score2: e.score2,
      confidence: Math.round(e.total / modelCount),
      agreement: e.agreement,
    }))
    .sort((a, b) => b.confidence - a.confidence || b.agreement - a.agreement)
    .slice(0, 3);

  const weights = new Map<string, number>();
  for (const r of results) {
    const winner = r.prediction.winner;
    if (!winner) continue;
    const w = r.prediction.scorelines?.[0]?.confidence ?? 1;
    weights.set(winner, (weights.get(winner) ?? 0) + w);
  }
  const winner = [...weights.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    team1: results[0]?.team1 ?? "",
    team2: results[0]?.team2 ?? "",
    scorelines,
    winner,
    modelCount,
  };
}

function ConsensusCard({
  consensus,
  t,
  team,
}: {
  consensus: Consensus;
  t: Translate;
  team: (name: string) => string;
}) {
  const { scorelines, winner, modelCount } = consensus;
  const maxConf = Math.max(1, ...scorelines.map((s) => s.confidence));

  return (
    <div className="relative overflow-hidden rounded-2xl border border-pitch-400/40 bg-pitch-400/[0.07] p-4 shadow-glow animate-fade-in-up sm:p-5">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pitch-300/70 to-transparent" />
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="text-pitch-300">✦</span>
          {t("consensusLabel")}
        </div>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-slate-400">
          {t("consensusFromPrefix")}
          {modelCount}
          {t("consensusFromSuffix")}
        </span>
      </div>

      <div className="space-y-2">
        {scorelines.map((s, i) => {
          const width = Math.max(6, Math.round((s.confidence / maxConf) * 100));
          const top = i === 0;
          return (
            <div key={`${s.score1}-${s.score2}-${i}`} className="flex items-center gap-3">
              <div
                className={`w-14 shrink-0 text-center text-base font-bold tabular-nums ${
                  top ? "text-white" : "text-slate-300"
                }`}
              >
                {s.score1}
                <span className="mx-1 text-slate-600">-</span>
                {s.score2}
              </div>
              <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-white/5">
                <div
                  className={`h-full rounded-lg transition-all duration-700 ${
                    top ? "bg-brand-gradient" : "bg-pitch-400/30"
                  }`}
                  style={{ width: `${width}%` }}
                />
                {modelCount > 1 && (
                  <span
                    className={`absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-medium ${
                      top ? "text-slate-950/70" : "text-slate-400"
                    }`}
                  >
                    {s.agreement}/{modelCount} {t("agreeWord")}
                  </span>
                )}
              </div>
              <div
                className={`w-10 shrink-0 text-right text-xs tabular-nums ${
                  top ? "text-pitch-200" : "text-slate-400"
                }`}
              >
                {s.confidence}%
              </div>
            </div>
          );
        })}
      </div>

      {winner && (
        <p className="mt-3 text-center text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pitch-400/40 bg-pitch-400/15 px-3 py-1 font-medium text-pitch-200">
            {winner === "Draw" ? t("drawText") : `${t("winnerPrefix")}${team(winner)}`}
          </span>
        </p>
      )}
    </div>
  );
}

function ModelPanel({
  label,
  isLoading,
  steps,
  error,
  result,
  onRetry,
  t,
  team,
}: {
  label: string;
  isLoading: boolean;
  steps: string[];
  error: string | null;
  result: PredictResponse | null;
  onRetry: () => void;
  t: Translate;
  team: (name: string) => string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <span
            className={`h-2 w-2 rounded-full ${
              result ? "bg-pitch-400" : isLoading ? "bg-amber-400 animate-pulse" : "bg-red-400"
            }`}
          />
          {label}
        </div>
        {result?.cached && (
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-slate-500">
            {t("savedNote").split(".")[0]}
          </span>
        )}
      </div>

      {isLoading && (
        <ul className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
          {steps.length === 0 && (
            <li className="flex items-center gap-2 text-xs text-slate-300">
              <span className="animate-spin text-pitch-400">↻</span>
              {t("stepResearching")}
            </li>
          )}
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            return (
              <li
                key={i}
                className="flex items-start gap-2.5 text-xs leading-relaxed animate-fade-in-up"
              >
                <span className={isLast ? "mt-px animate-spin text-pitch-400" : "mt-px text-pitch-400"}>
                  {isLast ? "↻" : "✓"}
                </span>
                <span className={isLast ? "text-slate-200" : "text-slate-400"}>{step}</span>
              </li>
            );
          })}
        </ul>
      )}

      {error && !isLoading && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          <span>{error}</span>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 rounded-lg border border-red-400/40 px-2.5 py-1 text-xs font-semibold text-red-100 transition hover:bg-red-500/20"
          >
            {t("retryModel")}
          </button>
        </div>
      )}

      {result && !isLoading && (
        <ModelResult result={result} t={t} team={team} />
      )}
    </div>
  );
}

function ModelResult({
  result,
  t,
  team,
}: {
  result: PredictResponse;
  t: Translate;
  team: (name: string) => string;
}) {
  const { prediction } = result;
  const scorelines = prediction.scorelines ?? [];
  const maxConf = Math.max(1, ...scorelines.map((s) => s.confidence));

  return (
    <div className="space-y-4 animate-fade-in-up">
      {/* Team header with flags + FIFA ranks. */}
      <div className="flex items-center justify-center gap-6 text-center">
        <TeamHead
          name={result.team1}
          rank={prediction.team1Ranking}
          team={team}
          rankLabel={t("rankLabel")}
        />
        <span className="text-xs font-light text-slate-600">{t("vs")}</span>
        <TeamHead
          name={result.team2}
          rank={prediction.team2Ranking}
          team={team}
          rankLabel={t("rankLabel")}
        />
      </div>

      {/* Scoreline confidence visualization. */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
          {t("scorelinesLabel")}
        </p>
        <div className="space-y-2">
          {scorelines.map((s, i) => {
            const width = Math.max(6, Math.round((s.confidence / maxConf) * 100));
            const top = i === 0;
            return (
              <div key={`${s.score1}-${s.score2}-${i}`} className="flex items-center gap-3">
                <div
                  className={`w-14 shrink-0 text-center text-base font-bold tabular-nums ${
                    top ? "text-white" : "text-slate-300"
                  }`}
                >
                  {s.score1}<span className="mx-1 text-slate-600">-</span>{s.score2}
                </div>
                <div className="relative h-6 flex-1 overflow-hidden rounded-lg bg-white/5">
                  <div
                    className={`h-full rounded-lg transition-all duration-700 ${
                      top ? "bg-brand-gradient" : "bg-pitch-400/30"
                    }`}
                    style={{ width: `${width}%` }}
                  />
                  {top && (
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-950/80">
                      {t("mostLikely")}
                    </span>
                  )}
                </div>
                <div
                  className={`w-10 shrink-0 text-right text-xs tabular-nums ${
                    top ? "text-pitch-200" : "text-slate-400"
                  }`}
                >
                  {s.confidence}%
                </div>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-center text-sm">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pitch-400/25 bg-pitch-400/10 px-3 py-1 text-pitch-300">
            {prediction.winner === "Draw"
              ? t("drawText")
              : `${t("winnerPrefix")}${team(prediction.winner)}`}
          </span>
        </p>
      </div>

      {Array.isArray(prediction.keyFactors) && prediction.keyFactors.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
            {t("keyFactorsLabel")}
          </p>
          <ul className="space-y-1.5">
            {prediction.keyFactors.map((factor, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-200">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-pitch-400" />
                <span>{factor}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {prediction.headToHead && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
            {t("h2hLabel")}
          </p>
          <p className="text-sm leading-relaxed text-slate-200">{prediction.headToHead}</p>
        </div>
      )}

      {(prediction.keyPlayers1 || prediction.keyPlayers2) && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
            {t("squadLabel")}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {prediction.keyPlayers1 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-1 text-xs font-semibold text-white">
                  {flagFor(result.team1)} {team(result.team1)}
                </div>
                <p className="text-xs leading-relaxed text-slate-300">{prediction.keyPlayers1}</p>
              </div>
            )}
            {prediction.keyPlayers2 && (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-1 text-xs font-semibold text-white">
                  {flagFor(result.team2)} {team(result.team2)}
                </div>
                <p className="text-xs leading-relaxed text-slate-300">{prediction.keyPlayers2}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.15em] text-slate-500">
          {t("reasoning")}
        </p>
        <p className="text-sm leading-relaxed text-slate-200">{prediction.reasoning}</p>
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
  );
}

function TeamHead({
  name,
  rank,
  team,
  rankLabel,
}: {
  name: string;
  rank?: number;
  team: (name: string) => string;
  rankLabel: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-2xl">{flagFor(name)}</div>
      <div className="mt-0.5 truncate text-xs text-slate-400">{team(name)}</div>
      {typeof rank === "number" && (
        <div className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-pitch-300">
          {rankLabel} #{rank}
        </div>
      )}
    </div>
  );
}
