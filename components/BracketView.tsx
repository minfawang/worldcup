"use client";

import type { WCMatch } from "@/lib/worldcup";
import { useLanguage } from "@/components/LanguageProvider";
import MatchCard from "./MatchCard";

const ROUND_ORDER = [
  "Round of 32",
  "Round of 16",
  "Quarter-final",
  "Semi-final",
  "Match for third place",
  "Final",
];

interface BracketViewProps {
  knockout: WCMatch[];
  selectedId: number | null;
  onSelect: (match: WCMatch) => void;
}

export default function BracketView({ knockout, selectedId, onSelect }: BracketViewProps) {
  const { t, round: roundName } = useLanguage();
  const byRound = new Map<string, WCMatch[]>();
  for (const m of knockout) {
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }

  const columns = ROUND_ORDER.filter((r) => byRound.has(r));

  if (columns.length === 0) {
    return (
      <p className="rounded-xl border border-slate-800 bg-slate-900/40 p-6 text-center text-slate-400">
        {t("bracketEmpty")}
      </p>
    );
  }

  return (
    <div className="thin-scroll snap-x-mandatory -mx-4 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0">
      <div className="flex min-w-max gap-4 sm:gap-6">
        {columns.map((round, idx) => {
          const matches = (byRound.get(round) ?? []).slice();
          return (
            <div
              key={round}
              className="flex w-[78vw] max-w-[16rem] shrink-0 snap-start flex-col sm:w-64"
            >
              <div className="mb-4 flex items-center justify-center">
                <span className="glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase tracking-[0.15em] text-slate-200">
                  <span className="grid h-4 w-4 place-items-center rounded-full bg-brand-gradient text-[9px] font-bold text-slate-950">
                    {idx + 1}
                  </span>
                  {roundName(round)}
                </span>
              </div>
              <div className="flex flex-1 flex-col justify-around gap-4">
                {matches.map((m) => (
                  <MatchCard
                    key={m.id}
                    match={m}
                    selected={selectedId === m.id}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
