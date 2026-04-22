# chessminds-dashboard

Local-only analytics dashboard for Chess of Minds. Reads from:

- **DynamoDB** (`chessminds-games` table) — all games + their configs + per-game event counters.
- **CloudWatch Logs** (`/aws/lambda/chessminds-api`) — structured game-start events and raw Lambda logs.

Binds to `127.0.0.1` by default. Never exposed externally.

---

## What you see

Top bar: KPIs (total games, active, last 24h, last hour, avg turns, total events).

Charts:
- Negotiation strategies (grouped bar: white vs black)
- Game mode (doughnut: ai_vs_ai vs human_vs_ai)
- Game status (doughnut: ongoing / checkmate / stalemate / ...)
- Turns reached histogram
- Personality presets (grouped bar: white vs black)

Tables:
- Recent 50 games. Click a row to pull all its events into a detail panel.
- Full events table per game, with summary column for PROPOSALs, MOVEs, AUCTION_RESULTs, etc.

Logs panel:
- CloudWatch Insights-style filter input (e.g. `"game_started"`, `ERROR`, `PROPOSAL`).
- Time window selector (15 min to 7 days).
- Auto-parses structured JSON log lines and pretty-prints them in ember.

Auto-refresh every 30 seconds. Manual refresh button in the header.

---

## Run it

```bash
cd apps/dashboard
uv sync
uv run python main.py
```

Then open **http://127.0.0.1:8765**.

Requires AWS credentials in your environment or `~/.aws/credentials` (the same
ones your `cdk deploy` uses). The dashboard makes `scan` / `query` on DDB and
`filter_log_events` on CloudWatch — no writes.

---

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `DASHBOARD_HOST` | Bind address | `127.0.0.1` |
| `DASHBOARD_PORT` | Port | `8765` |
| `GAME_TABLE` | DynamoDB table name | `chessminds-games` |
| `LOG_GROUP` | CloudWatch log group | `/aws/lambda/chessminds-api` |
| `AWS_REGION` | AWS region | `us-east-1` |

To expose beyond localhost (e.g. over SSH tunnel), set `DASHBOARD_HOST=0.0.0.0`
and bind the port carefully. **Don't do this on a public network** — there's no
auth in front of the endpoints.

---

## Endpoints (all JSON)

- `GET /` — the UI.
- `GET /api/stats` — aggregated KPIs + distributions. 30s server-side cache.
- `GET /api/games?limit=50` — recent games, most recent first. 30s cache.
- `GET /api/games/{id}/events` — event list for one game.
- `GET /api/logs?filter_pattern=...&since_minutes=60&limit=50` — CloudWatch search.
- `GET /api/config` — shows which table + log group + region this instance is querying.

Good for piping into jq / scripts: `curl 127.0.0.1:8765/api/games | jq`.

---

## Cost

Each page load does at most one DDB `scan` across the table. With the TTL on the
games table (7 days), the scan size stays small. CloudWatch `filter_log_events`
is free for the volumes we'd emit from this project.

If you ever push this table past ~10k games, replace the scan with a GSI on
`created_at` or add DynamoDB Streams → a rolled-up stats record.

---

## Design notes

- **No Node build step.** Tailwind + Chart.js come from CDNs. One HTML file.
- **No framework.** Vanilla JS + fetch(). Chart.js instances are destroyed + replaced on every refresh so the UI doesn't leak memory.
- **Auto-refresh interval is 30s** because the upstream cache is 30s.
- **Prefers-color-scheme dark** is wired up, but most panels still read on light background. Tune later if needed.
