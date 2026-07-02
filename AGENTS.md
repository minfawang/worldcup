# World Cup Predictor — Project Guide

Context for AI agents working in this repo. Read this first to understand the
architecture, data flow, and conventions before making changes.

## What it is

A Next.js (App Router) web app that:

1. Shows the live **2026 FIFA World Cup** schedule as a group-stage view (12
   groups with mini standings) and a knockout **bracket** view.
2. Lets a visitor pick any **predictable upcoming match** and have **Claude**
   predict the scoreline + reasoning, choosing between **Sonnet** and **Opus**.
3. Is fully **bilingual (English / 简体中文)** with auto-detection from the
   browser and a manual toggle.

Schedule data comes from the public
[openfootball/worldcup.json](https://github.com/openfootball/worldcup.json)
dataset (no API key). Predictions require an Anthropic API key and use Claude's
`web_search` server tool to research teams before answering.

## Tech stack

- **Next.js 15** (App Router, React 19, RSC + client components), **TypeScript** (strict).
- **Tailwind CSS 3** for styling (custom theme in `tailwind.config.ts`; dark, "glassmorphism" UI).
- **@anthropic-ai/sdk** for predictions (streaming, tool use, web search).
- **@upstash/redis** for durable prediction storage (optional; falls back to a local JSON file).
- Deployed on **Vercel**. `npm run dev` / `build` / `start` / `lint`.
- Import alias: `@/*` → repo root (see `tsconfig.json`).

## Directory map

```
app/
  layout.tsx              Root layout: fonts, background gradients, wraps app in LanguageProvider.
  page.tsx                Main client page: tabs (Groups/Bracket), 10-min auto-refresh + countdown, opens PredictPanel.
  globals.css             Tailwind layers + custom animations/utilities (glass, brand-gradient, etc).
  api/schedule/route.ts   GET schedule (normalized + cached). ?refresh=1 bypasses cache.
  api/predict/route.ts    GET = read cached prediction only; POST = run/stream a new Claude prediction.
components/
  LanguageProvider.tsx    i18n context: lang state, localStorage persistence, t()/team()/round()/group() helpers.
  ScheduleView.tsx        Group cards: standings table + MatchCards per group.
  BracketView.tsx         Knockout bracket, columns by round (fixed ROUND_ORDER), horizontally scrollable.
  MatchCard.tsx           A single match tile (teams, flags, score/kickoff, "Predict"/FT/TBD state). Clickable only if predictable.
  PredictPanel.tsx        Modal/bottom-sheet: model picker, runs prediction, streams progress, renders full result.
lib/
  worldcup.ts             Core domain types + fetch/normalize logic (raw openfootball JSON → Schedule/Group/Standing/WCMatch).
  scheduleCache.ts        In-process schedule cache (5-min TTL) on globalThis, with in-flight de-dupe.
  predictionCache.ts      Prediction persistence: in-memory + Redis (if configured) else .data/predictions.json. Includes normalizeKeyFactors.
  models.ts               ModelKey ("sonnet"|"opus") → label/description/concrete Anthropic model id (env-overridable).
  i18n.ts                 Lang type, DICT (all UI strings en/zh), team/round/group translation tables, matchLang() detection.
  flags.ts                Team name → flag emoji.
```

## Data model (lib/worldcup.ts)

- `WCMatch`: normalized match. Key flags:
  - `stage`: `"group" | "knockout"` (derived from presence of `group`).
  - `status`: `"played" | "upcoming"` (played = has a full-time score).
  - `team1Placeholder` / `team2Placeholder`: true when the slot is an undecided
    seed like `W89`, `1A`, `3ABCD` (regex `PLACEHOLDER_RE`), i.e. not a real team yet.
  - `predictable`: `upcoming && both teams known` — **only these matches are clickable/predictable**.
  - `kickoffUtc`: ISO UTC parsed from `date` + `time` (handles `UTC±HH:MM` offsets).
- `Schedule`: `{ name, teams[], groups[], matches[] (all, sorted by kickoff), knockout[] }`.
- Group standings are computed in `buildGroups` (3/1/0 points, sorted by pts → GD → GF → name).

## Prediction flow (app/api/predict/route.ts)

`POST /api/predict` with `{ matchId, model, lang }`:

1. Return cached prediction (keyed by `matchId:model:lang`) if present — no Claude call.
2. Validate: `matchId` exists, teams are decided (not placeholders), `ANTHROPIC_API_KEY` set.
3. Build a prompt with tournament form + instructions to use `web_search`.
4. Stream a Claude turn; loop while `stop_reason === "pause_turn"` (web search pauses the turn), up to a guard limit.
5. Force a `submit_prediction` tool call (structured output: score1/score2/winner/confidence/reasoning + optional rankings, H2H, key players, keyFactors).
6. Persist result and emit it. Knockout matches cannot be "Draw" (winner enum excludes it).

Response is **newline-delimited JSON (NDJSON)** streamed to the client. Event
types: `status` (researching/finalizing), `search` (a web query), `result`
(final payload), `error`. Cached hits return a single plain JSON object instead.
`GET /api/predict?matchId&model&lang` is a **read-only** cache lookup (used on
panel open to auto-show a saved prediction).

## Caching / persistence

- **Schedule**: `lib/scheduleCache.ts`, in-process on `globalThis`, 5-min TTL,
  cleared on server restart. `?refresh=1` forces a reload.
- **Predictions**: `lib/predictionCache.ts`:
  - Always cached in an in-memory `Map` (key `matchId:model:lang`).
  - Durable backend = **Upstash Redis** when `UPSTASH_REDIS_REST_*` or
    `KV_REST_API_*` env vars are set (use this on Vercel); otherwise a local
    `.data/predictions.json` (atomic temp-file + rename, chained writes).
  - `normalizeKeyFactors` repairs mis-shaped model output (single string, or
    `<item>`-tagged) into a clean `string[]`, on both write and read.

## i18n conventions

- Two languages: `"en"` (default/fallback) and `"zh"`.
- All UI copy lives in `DICT` in `lib/i18n.ts`. **Add new UI strings there** (both
  `en` and `zh`) and read them via `t("key")` from `useLanguage()`.
- Team / round / group names are translated via `translateTeam/Round/Group`
  (and flags via `lib/flags.ts`); when adding teams, update both `TEAM_ZH` and `FLAGS`.
- Prediction free-text is generated in the requested language (see `langNote` in the prompt);
  predictions are cached per language.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | for predictions | Enables Claude predictions (schedule works without it). |
| `CLAUDE_SONNET_MODEL` | no | Override Sonnet model id (default in `lib/models.ts`). |
| `CLAUDE_OPUS_MODEL` | no | Override Opus model id. |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | for durable predictions | Upstash Redis. `KV_REST_API_URL` / `_TOKEN` also accepted. |

See `.env.local.example`. Model ids are env-overridable so the app keeps working as new Claude models ship.

## Conventions & gotchas

- Client components are marked `"use client"` (page + all components use it; the
  API routes are server-only with `export const dynamic = "force-dynamic"`).
- Only render/allow prediction for `match.predictable` matches — placeholder
  slots (`❔` / seed codes) must not be treated as real teams.
- The prediction endpoint streams NDJSON; if you change the event shape, update
  the reader loop in `PredictPanel.tsx` too.
- Keep prediction cache keys consistent as `matchId:model:lang` across GET/POST/get/set.
- Styling uses custom Tailwind theme tokens (`pitch-*`, `neon-*`, `brand-gradient`,
  `glass`, `shadow-glow`, etc.) defined in `tailwind.config.ts` / `globals.css`.
```
