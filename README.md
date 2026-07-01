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

## Deploy to Vercel

This is a standard Next.js app, so [Vercel](https://vercel.com) is the easiest host
(free Hobby tier). You can deploy straight from the CLI — no GitHub repo required.

### First-time setup

```bash
npm i -g vercel@latest        # the API requires a recent CLI version
vercel login                  # authenticate
vercel link --yes             # create/link the project (pass --scope <team> if prompted)
```

Add your secrets as Vercel environment variables (Production + Preview):

```bash
vercel env add ANTHROPIC_API_KEY production
vercel env add ANTHROPIC_API_KEY preview
```

For durable, shared prediction storage, add an Upstash Redis database from the Vercel
dashboard: **Project → Storage → Create Database → Upstash → Redis**, then link it to
the project. Vercel auto-injects the connection env vars (`KV_REST_API_URL` /
`KV_REST_API_TOKEN`, or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`) — both
naming schemes are supported. Without it, predictions still work but aren't persisted
across serverless instances.

### Deploy / push updates

```bash
vercel deploy --prod --yes    # build + deploy to production
```

Run this again any time you want to push new changes to production. Environment-variable
changes only take effect after the next deploy, so redeploy after adding/updating them.

> Prefer git-based auto-deploys? Push the repo to GitHub, then import the project in the
> Vercel dashboard and connect it to the repo — after that every `git push` deploys
> automatically.

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
