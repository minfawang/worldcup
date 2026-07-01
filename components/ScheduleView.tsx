"use client";

import type { Group, WCMatch } from "@/lib/worldcup";
import { flagFor } from "@/lib/flags";
import MatchCard from "./MatchCard";

interface GroupCardProps {
  group: Group;
  selectedId: number | null;
  onSelect: (match: WCMatch) => void;
}

function GroupCard({ group, selectedId, onSelect }: GroupCardProps) {
  return (
    <div className="flex flex-col rounded-2xl border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-pitch-500">
        {group.name}
      </h3>

      <table className="mb-4 w-full text-xs">
        <thead>
          <tr className="text-slate-500">
            <th className="pb-1 text-left font-medium">Team</th>
            <th className="pb-1 text-center font-medium">P</th>
            <th className="pb-1 text-center font-medium">GD</th>
            <th className="pb-1 text-center font-medium">Pts</th>
          </tr>
        </thead>
        <tbody>
          {group.standings.map((s, i) => (
            <tr
              key={s.team}
              className={i < 2 ? "text-slate-100" : "text-slate-400"}
            >
              <td className="flex items-center gap-1.5 py-0.5">
                <span className={`h-1.5 w-1.5 rounded-full ${i < 2 ? "bg-pitch-500" : "bg-slate-700"}`} />
                <span>{flagFor(s.team)}</span>
                <span className="truncate">{s.team}</span>
              </td>
              <td className="text-center tabular-nums">{s.played}</td>
              <td className="text-center tabular-nums">
                {s.gd > 0 ? `+${s.gd}` : s.gd}
              </td>
              <td className="text-center font-semibold tabular-nums">{s.points}</td>
            </tr>
          ))}
          {group.standings.length === 0 && (
            <tr>
              <td colSpan={4} className="py-1 text-slate-500">
                Teams TBD
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
