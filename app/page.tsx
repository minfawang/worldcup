"use client";

import { useCallback, useEffect, useState } from "react";
import type { Schedule, WCMatch } from "@/lib/worldcup";
import ScheduleView from "@/components/ScheduleView";
import BracketView from "@/components/BracketView";
import PredictPanel from "@/components/PredictPanel";
import { useLanguage } from "@/components/LanguageProvider";
import { LANGS } from "@/lib/i18n";

type Tab = "groups" | "bracket";

interface ScheduleResponse {
  fetchedAt: string;
  data: Schedule;
}

const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

export default function Home() {
  const { t, lang, setLang, locale } = useLanguage();
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("bracket");
  const [selected, setSelected] = useState<WCMatch | null>(null);
  const [nextRefreshAt, setNextRefreshAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (refresh: boolean) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/schedule${refresh ? "?refresh=1" : ""}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load schedule.");
      const { fetchedAt, data } = json as ScheduleResponse;
      setSchedule(data);
      setFetchedAt(fetchedAt);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load schedule.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  useEffect(() => {
    setNextRefreshAt(Date.now() + REFRESH_INTERVAL_MS);
    const id = setInterval(() => {
      load(true);
      setNextRefreshAt(Date.now() + REFRESH_INTERVAL_MS);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const upcomingCount = schedule?.matches.filter((m) => m.predictable).length ?? 0;

  const remainingMs = nextRefreshAt ? Math.max(0, nextRefreshAt - now) : 0;
  const countdown = `${Math.floor(remainingMs / 60000)}:${String(
    Math.floor((remainingMs % 60000) / 1000)
  ).padStart(2, "0")}`;

  return (
    <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="animate-fade-in-up">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-pitch-300 backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-pitch-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-pitch-400" />
            </span>
            {t("liveBadge")}
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
            <span className="text-gradient">{t("titleMain")}</span>
            <span className="ml-2 font-light text-slate-400">{t("titleSuffix")}</span>
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-400">{t("tagline")}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="glass inline-flex rounded-xl p-1">
            {LANGS.map((l) => (
              <button
                key={l.key}
                type="button"
                onClick={() => setLang(l.key)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  lang === l.key
                    ? "bg-brand-gradient text-slate-950"
                    : "text-slate-400 hover:text-slate-100"
                }`}
              >
                {l.label}
              </button>
            ))}
          </div>
          <span className="hidden items-center gap-1.5 text-xs text-slate-500 sm:inline-flex">
            <span className={`text-slate-600 ${refreshing ? "inline-block animate-spin" : ""}`}>↻</span>
            {refreshing ? (
              t("refreshing")
            ) : (
              <span>
                {t("nextRefreshPrefix")}
                <span className="tabular-nums">{countdown}</span>
              </span>
            )}
            {fetchedAt && (
              <span className="text-slate-600">
                · {t("updatedPrefix")}
                {new Date(fetchedAt).toLocaleTimeString(locale)}
              </span>
            )}
          </span>
        </div>
      </header>

      <div className="mb-8 flex flex-wrap items-center gap-3">
        <div className="glass inline-flex rounded-2xl p-1">
          <TabButton active={tab === "groups"} onClick={() => setTab("groups")}>
            {t("groups")}
          </TabButton>
          <TabButton active={tab === "bracket"} onClick={() => setTab("bracket")}>
            {t("bracket")}
          </TabButton>
        </div>
        {upcomingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-pitch-400/25 bg-pitch-400/10 px-3 py-1.5 text-xs font-medium text-pitch-300 shadow-glow">
            <span className="h-1.5 w-1.5 rounded-full bg-pitch-400" />
            {lang === "zh"
              ? `${upcomingCount} 场比赛可预测`
              : `${upcomingCount} match${upcomingCount === 1 ? "" : "es"} to predict`}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200 backdrop-blur">
          {error}
          <button
            type="button"
            onClick={() => load(false)}
            className="ml-3 underline hover:text-red-100"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {loading && !schedule ? (
        <div className="flex items-center justify-center py-28 text-slate-400">
          <span className="mr-3 animate-spin text-xl text-pitch-400">↻</span>
          {t("loading")}
        </div>
      ) : schedule ? (
        <div key={tab} className="animate-fade-in-up">
          {tab === "groups" ? (
            <ScheduleView
              groups={schedule.groups}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
            />
          ) : (
            <BracketView
              knockout={schedule.knockout}
              selectedId={selected?.id ?? null}
              onSelect={setSelected}
            />
          )}
        </div>
      ) : null}

      {selected && (
        <PredictPanel match={selected} onClose={() => setSelected(null)} />
      )}

      <footer className="mt-16 border-t border-white/5 pt-6 text-center text-xs text-slate-500">
        {t("footerPre")}
        <a
          href="https://github.com/openfootball/worldcup.json"
          className="text-slate-400 underline-offset-2 hover:text-pitch-300 hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          openfootball
        </a>
        {t("footerPost")}
      </footer>
    </main>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-xl px-5 py-2 text-sm font-medium transition ${
        active
          ? "bg-brand-gradient text-slate-950 shadow-glow"
          : "text-slate-400 hover:text-slate-100"
      }`}
    >
      {children}
    </button>
  );
}
