"use client";

import type { WCMatch } from "@/lib/worldcup";
import { flagFor } from "@/lib/flags";
import { useLanguage } from "@/components/LanguageProvider";

function formatKickoff(match: WCMatch, locale: string): string {
  if (!match.kickoffUtc) return match.date || "TBD";
  const d = new Date(match.kickoffUtc);
  return d.toLocaleString(locale, {
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
  const { team } = useLanguage();
  const dim = emphasize && !isWinner && score != null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={`flex min-w-0 items-center gap-2 ${
          emphasize && isWinner ? "font-semibold text-white" : dim ? "text-slate-400" : "text-slate-200"
        }`}
      >
        <span className="text-lg leading-none">{placeholder ? "❔" : flagFor(name)}</span>
        <span className="truncate">{placeholder ? name : team(name)}</span>
      </span>
      {score != null && (
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-md text-xs tabular-nums ${
            emphasize && isWinner
              ? "bg-brand-gradient font-bold text-slate-950"
              : "bg-white/5 text-slate-300"
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
  const { t, locale } = useLanguage();
  const played = match.status === "played";
  const team1Wins = played && (match.score1 ?? 0) > (match.score2 ?? 0);
  const team2Wins = played && (match.score2 ?? 0) > (match.score1 ?? 0);

  const clickable = match.predictable;

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onSelect(match)}
      className={`group relative w-full overflow-hidden rounded-2xl border p-3.5 text-left text-sm transition duration-200 ${
        selected
          ? "border-pitch-400/60 bg-pitch-400/[0.07] shadow-glow"
          : "border-white/[0.07] bg-white/[0.03]"
      } ${
        clickable
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-pitch-400/50 hover:bg-white/[0.06] hover:shadow-glow"
          : "cursor-default opacity-95"
      }`}
    >
      {match.predictable && (
        <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-pitch-400/70 to-transparent" />
      )}
      <div className="mb-2.5 flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.15em] text-slate-500">
        <span>{formatKickoff(match, locale)}</span>
        {played ? (
          <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-slate-300">{t("ft")}</span>
        ) : match.predictable ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-pitch-400/15 px-1.5 py-0.5 text-pitch-300 transition group-hover:bg-pitch-400/25">
            {t("predict")}
            <span className="transition group-hover:translate-x-0.5">→</span>
          </span>
        ) : (
          <span className="rounded-md bg-white/[0.03] px-1.5 py-0.5 text-slate-600">{t("tbd")}</span>
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
        <div className="mt-2.5 truncate text-[11px] text-slate-500">{match.ground}</div>
      )}
    </button>
  );
}
