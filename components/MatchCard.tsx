"use client";

import type { WCMatch } from "@/lib/worldcup";
import { flagFor } from "@/lib/flags";

function formatKickoff(match: WCMatch): string {
  if (!match.kickoffUtc) return match.date || "TBD";
  const d = new Date(match.kickoffUtc);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface TeamRowProps {
  name: string;
  placeholder: boolean;
  score: number | null;
  isWinner: boolean;
  emphasize: boolean;
}

function TeamRow({ name, placeholder, score, isWinner, emphasize }: TeamRowProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={`flex min-w-0 items-center gap-2 ${
          emphasize && isWinner ? "font-semibold text-white" : "text-slate-200"
        }`}
      >
        <span className="text-lg leading-none">{placeholder ? "❔" : flagFor(name)}</span>
        <span className="truncate">{name}</span>
      </span>
      {score != null && (
        <span
          className={`tabular-nums ${
            emphasize && isWinner ? "font-bold text-white" : "text-slate-300"
          }`}
        >
          {score}
        </span>
      )}
    </div>
  );
}

interface MatchCardProps {
  match: WCMatch;
  selected: boolean;
  onSelect: (match: WCMatch) => void;
}

export default function MatchCard({ match, selected, onSelect }: MatchCardProps) {
  const played = match.status === "played";
  const team1Wins = played && (match.score1 ?? 0) > (match.score2 ?? 0);
  const team2Wins = played && (match.score2 ?? 0) > (match.score1 ?? 0);

  const clickable = match.predictable;

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onSelect(match)}
      className={`group w-full rounded-xl border p-3 text-left text-sm transition ${
        selected
          ? "border-pitch-500 bg-pitch-500/10 ring-1 ring-pitch-500"
          : "border-slate-800 bg-slate-900/60"
      } ${
        clickable
          ? "cursor-pointer hover:border-pitch-500/70 hover:bg-slate-800/70"
          : "cursor-default"
      }`}
    >
      <div className="mb-2 flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400">
        <span>{formatKickoff(match)}</span>
        {played ? (
          <span className="rounded bg-slate-700/70 px-1.5 py-0.5 text-slate-200">FT</span>
        ) : match.predictable ? (
          <span className="rounded bg-pitch-500/20 px-1.5 py-0.5 text-pitch-500">
            Predict →
          </span>
        ) : (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-500">TBD</span>
        )}
      </div>

      <div className="space-y-1.5">
        <TeamRow
          name={match.team1}
          placeholder={match.team1Placeholder}
          score={match.score1}
          isWinner={team1Wins}
          emphasize={played}
        />
        <TeamRow
          name={match.team2}
          placeholder={match.team2Placeholder}
          score={match.score2}
          isWinner={team2Wins}
          emphasize={played}
        />
      </div>

      {match.ground && (
        <div className="mt-2 truncate text-[11px] text-slate-500">{match.ground}</div>
      )}
    </button>
  );
}
