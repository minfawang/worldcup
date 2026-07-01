"use client";

import type { WCMatch } from "@/lib/worldcup";
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
        The knockout bracket has not been drawn yet.
      </p>
    );
  }

  return (
    <div className="thin-scroll overflow-x-auto pb-3">
      <div className="flex min-w-max gap-5">
        {columns.map((round) => {
          const matches = (byRound.get(round) ?? []).slice();
          return (
            <div key={round} className="flex w-64 shrink-0 flex-col">
              <h3 className="mb-3 text-center text-sm font-semibold uppercase tracking-wide text-pitch-500">
                {round}
              </h3>
              <div className="flex flex-1 flex-col justify-around gap-3">
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
