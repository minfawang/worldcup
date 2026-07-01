# World Cup Predictor

A Next.js webapp that visualizes the live 2026 FIFA World Cup schedule and knockout
bracket, and lets visitors predict upcoming matches (final score + reasoning) using
Claude, with a switch between the Sonnet and Opus models.

## Features

- Live 2026 World Cup schedule + bracket, fetched from the public
  [openfootball](https://github.com/openfootball/worldcup.json) dataset (no API key needed).
- Auto-refreshes the latest fixtures/results every 10 minutes, with a live countdown to the next refresh.
- Group-stage view (12 groups with mini standings) and a knockout bracket view.
- Select any upcoming match and predict the result with Claude.
- Toggle between **Claude Sonnet** and **Claude Opus** in the UI.

## Getting started

```bash
npm install
cp .env.local.example .env.local   # then add your ANTHROPIC_API_KEY
npm run dev
```

Open http://localhost:3000.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | For predictions | Your Anthropic API key. The schedule works without it. |
| `CLAUDE_SONNET_MODEL` | No | Override the Sonnet model ID (default in `lib/models.ts`). |
| `CLAUDE_OPUS_MODEL` | No | Override the Opus model ID (default in `lib/models.ts`). |
| `UPSTASH_REDIS_REST_URL` | For durable predictions | Upstash Redis REST URL. Enables shared, persistent prediction storage on Vercel. |
| `UPSTASH_REDIS_REST_TOKEN` | For durable predictions | Upstash Redis REST token (pairs with the URL above). |

## How it works

- `GET /api/schedule` fetches + normalizes the openfootball JSON and caches it in memory.
  Append `?refresh=1` (what the Refresh button does) to bypass the cache.
- `POST /api/predict` takes `{ matchId, model }`, looks up the match plus group context,
  and asks Claude for a structured prediction (`score1`, `score2`, `winner`, `confidence`,
  `reasoning`).

## Notes

- The schedule cache lives in the server process; restarting `npm run dev` clears it.
- Predictions are cached in memory and persisted to a durable backend:
  - When `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, they are stored
    in Upstash Redis (shared across instances, survives restarts — use this on Vercel).
  - Otherwise they fall back to `.data/predictions.json` (local single-instance store;
    delete that file to clear saved predictions).
- Exact Claude model IDs are configurable via env so they can be updated as new models ship.
