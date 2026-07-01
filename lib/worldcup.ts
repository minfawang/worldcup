export const WORLDCUP_SOURCE_URL =
  "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

export type MatchStatus = "played" | "upcoming";
export type Stage = "group" | "knockout";

interface RawGoal {
  name?: string;
  minute?: string | number;
  penalty?: boolean;
  owngoal?: boolean;
}

interface RawMatch {
  num?: number;
  round?: string;
  date?: string;
  time?: string;
  team1?: string;
  team2?: string;
  score?: { ft?: [number, number]; ht?: [number, number] };
  goals1?: RawGoal[];
  goals2?: RawGoal[];
  group?: string;
  ground?: string;
}

interface RawWorldCup {
  name?: string;
  matches?: RawMatch[];
}

export interface WCMatch {
  id: number;
  round: string;
  stage: Stage;
  group: string | null;
  date: string;
  time: string;
  kickoffUtc: string | null;
  ground: string;
  team1: string;
  team2: string;
  team1Placeholder: boolean;
  team2Placeholder: boolean;
  score1: number | null;
  score2: number | null;
  status: MatchStatus;
  /** Upcoming match where both teams are known (safe to predict with real teams). */
  predictable: boolean;
}

export interface Standing {
  team: string;
  played: number;
  win: number;
  draw: number;
  loss: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

export interface Group {
  name: string;
  standings: Standing[];
  matches: WCMatch[];
}

export interface Schedule {
  name: string;
  teams: string[];
  groups: Group[];
  /** All matches, sorted by kickoff. */
  matches: WCMatch[];
  /** Knockout-stage matches only, sorted by kickoff. */
  knockout: WCMatch[];
}

// Undecided knockout slots look like "W89"/"L101"; group-position slots like "1A"/"3ABCD".
const PLACEHOLDER_RE = /^(?:[WL]\d{1,3}|RU\d{1,2}|\d[A-L]|[123][A-L/]{1,6})$/;

function isPlaceholder(team: string): boolean {
  if (!team) return true;
  return PLACEHOLDER_RE.test(team.trim());
}

/** Parse "2026-06-11" + "13:00 UTC-6" into a UTC ISO string. */
function parseKickoff(date?: string, time?: string): string | null {
  if (!date) return null;
  const timeMatch = time?.match(/(\d{1,2}):(\d{2})/);
  const hour = timeMatch ? Number(timeMatch[1]) : 0;
  const minute = timeMatch ? Number(timeMatch[2]) : 0;

  const offsetMatch = time?.match(/UTC([+-]\d{1,2})(?::?(\d{2}))?/i);
  const offsetHours = offsetMatch ? Number(offsetMatch[1]) : 0;
  const offsetMinutes = offsetMatch && offsetMatch[2] ? Number(offsetMatch[2]) : 0;

  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return null;

  // Local time = UTC + offset  =>  UTC = local - offset.
  const utcMs = Date.UTC(y, m - 1, d, hour, minute);
  const offsetTotalMinutes =
    (offsetHours < 0 ? -1 : 1) * (Math.abs(offsetHours) * 60 + offsetMinutes);
  const adjusted = utcMs - offsetTotalMinutes * 60 * 1000;
  return new Date(adjusted).toISOString();
}

function normalizeMatch(raw: RawMatch, index: number): WCMatch {
  const team1 = (raw.team1 ?? "").trim();
  const team2 = (raw.team2 ?? "").trim();
  const ft = raw.score?.ft;
  const hasScore = Array.isArray(ft) && ft.length === 2;
  const group = raw.group ? raw.group.trim() : null;

  const team1Placeholder = isPlaceholder(team1);
  const team2Placeholder = isPlaceholder(team2);
  const status: MatchStatus = hasScore ? "played" : "upcoming";

  return {
    id: raw.num ?? index + 1,
    round: raw.round ?? "",
    stage: group ? "group" : "knockout",
    group,
    date: raw.date ?? "",
    time: raw.time ?? "",
    kickoffUtc: parseKickoff(raw.date, raw.time),
    ground: raw.ground ?? "",
    team1,
    team2,
    team1Placeholder,
    team2Placeholder,
    score1: hasScore ? ft![0] : null,
    score2: hasScore ? ft![1] : null,
    status,
    predictable: status === "upcoming" && !team1Placeholder && !team2Placeholder,
  };
}

function sortByKickoff(a: WCMatch, b: WCMatch): number {
  const ta = a.kickoffUtc ? Date.parse(a.kickoffUtc) : 0;
  const tb = b.kickoffUtc ? Date.parse(b.kickoffUtc) : 0;
  if (ta !== tb) return ta - tb;
  return a.id - b.id;
}

function emptyStanding(team: string): Standing {
  return { team, played: 0, win: 0, draw: 0, loss: 0, gf: 0, ga: 0, gd: 0, points: 0 };
}

function buildGroups(matches: WCMatch[]): Group[] {
  const groupMap = new Map<string, WCMatch[]>();
  for (const m of matches) {
    if (m.stage !== "group" || !m.group) continue;
    const list = groupMap.get(m.group) ?? [];
    list.push(m);
    groupMap.set(m.group, list);
  }

  const groups: Group[] = [];
  for (const [name, groupMatches] of groupMap) {
    const table = new Map<string, Standing>();
    const ensure = (team: string) => {
      if (!table.has(team)) table.set(team, emptyStanding(team));
      return table.get(team)!;
    };

    for (const m of groupMatches) {
      if (!m.team1Placeholder) ensure(m.team1);
      if (!m.team2Placeholder) ensure(m.team2);
      if (m.status !== "played" || m.score1 == null || m.score2 == null) continue;

      const s1 = ensure(m.team1);
      const s2 = ensure(m.team2);
      s1.played += 1;
      s2.played += 1;
      s1.gf += m.score1;
      s1.ga += m.score2;
      s2.gf += m.score2;
      s2.ga += m.score1;

      if (m.score1 > m.score2) {
        s1.win += 1;
        s1.points += 3;
        s2.loss += 1;
      } else if (m.score1 < m.score2) {
        s2.win += 1;
        s2.points += 3;
        s1.loss += 1;
      } else {
        s1.draw += 1;
        s2.draw += 1;
        s1.points += 1;
        s2.points += 1;
      }
    }

    const standings = [...table.values()]
      .map((s) => ({ ...s, gd: s.gf - s.ga }))
      .sort(
        (a, b) =>
          b.points - a.points ||
          b.gd - a.gd ||
          b.gf - a.gf ||
          a.team.localeCompare(b.team),
      );

    groups.push({
      name,
      standings,
      matches: groupMatches.slice().sort(sortByKickoff),
    });
  }

  return groups.sort((a, b) => a.name.localeCompare(b.name));
}

export function normalizeWorldCup(raw: RawWorldCup): Schedule {
  const rawMatches = Array.isArray(raw.matches) ? raw.matches : [];
  const matches = rawMatches.map(normalizeMatch).sort(sortByKickoff);

  const teamSet = new Set<string>();
  for (const m of matches) {
    if (!m.team1Placeholder) teamSet.add(m.team1);
    if (!m.team2Placeholder) teamSet.add(m.team2);
  }

  return {
    name: raw.name ?? "World Cup 2026",
    teams: [...teamSet].sort(),
    groups: buildGroups(matches),
    matches,
    knockout: matches.filter((m) => m.stage === "knockout").sort(sortByKickoff),
  };
}

export async function fetchSchedule(): Promise<Schedule> {
  const res = await fetch(WORLDCUP_SOURCE_URL, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch schedule: ${res.status} ${res.statusText}`);
  }
  const raw = (await res.json()) as RawWorldCup;
  return normalizeWorldCup(raw);
}

export function findMatch(schedule: Schedule, id: number): WCMatch | undefined {
  return schedule.matches.find((m) => m.id === id);
}
