"use client";

import type { Group, WCMatch } from "@/lib/worldcup";
import { flagFor } from "@/lib/flags";
import { useLanguage } from "@/components/LanguageProvider";
import MatchCard from "./MatchCard";

interface GroupCardProps {
  group: Group;
  selectedId: number | null;
  onSelect: (match: WCMatch) => void;
}

function GroupCard({ group, selectedId, onSelect }: GroupCardProps) {
  const { t, team, group: groupName } = useLanguage();
  return (
    <div className="glass flex flex-col rounded-3xl p-5 shadow-card transition duration-300 hover:border-white/20">
      <div className="mb-4 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-gradient text-xs font-bold text-slate-950">
          {group.name.replace(/[^A-Z]/g, "")}
        </span>
        <h3 className="text-sm font-semibold uppercase tracking-[0.15em] text-slate-300">
          {groupName(group.name)}
        </h3>
      </div>

      <table className="mb-5 w-full text-xs">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-slate-500">
            <th className="pb-2 text-left font-medium">{t("teamCol")}</th>
            <th className="pb-2 text-center font-medium">{t("pCol")}</th>
            <th className="pb-2 text-center font-medium">{t("gdCol")}</th>
            <th className="pb-2 text-center font-medium">{t("ptsCol")}</th>
          </tr>
        </thead>
        <tbody>
          {group.standings.map((s, i) => (
            <tr
              key={s.team}
              className={`border-t border-white/5 ${i < 2 ? "text-slate-100" : "text-slate-500"}`}
            >
              <td className="flex items-center gap-2 py-1.5">
                <span
                  className={`h-4 w-0.5 rounded-full ${i < 2 ? "bg-brand-gradient" : "bg-white/10"}`}
                />
                <span>{flagFor(s.team)}</span>
                <span className="truncate">{team(s.team)}</span>
              </td>
              <td className="text-center tabular-nums">{s.played}</td>
              <td className="text-center tabular-nums">
                {s.gd > 0 ? `+${s.gd}` : s.gd}
              </td>
              <td className="text-center font-semibold tabular-nums text-slate-200">
                {s.points}
              </td>
            </tr>
          ))}
          {group.standings.length === 0 && (
            <tr>
              <td colSpan={4} className="py-2 text-slate-500">
                {t("teamsTbd")}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-auto space-y-2">
        {group.matches.map((m) => (
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
}

interface ScheduleViewProps {
  groups: Group[];
  selectedId: number | null;
  onSelect: (match: WCMatch) => void;
}

export default function ScheduleView({ groups, selectedId, onSelect }: ScheduleViewProps) {
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => (
        <GroupCard key={g.name} group={g} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
