# Chess of Minds

**Chess, played by thirty-two minds.** Every piece is an AI agent with its own personality, voice, and strategic opinions. They propose, argue, and trash-talk their way to every move. The goal is not a strong chess engine — it's the most entertaining AI chess you've ever watched.

---

## Try it

Open a Claude Code session anywhere and paste:

```
Use https://chessminds-psi.vercel.app/play.md to start a chess game
```

Claude Code fetches a single markdown file that fully specifies the game loop. It creates a session on the backend, prints a live watch URL, and plays the match by spawning piece-agent sub-agents in parallel. Share the URL — friends can watch moves + negotiation stream into their browser in real time.

**Cost model:** every LLM call happens inside your local Claude Code session. For Pro/Max subscribers, a full game is free at the token level. The backend only relays state; it never talks to an LLM.

---

## How it works

Three layers with narrow, non-overlapping roles:

```
┌────────────────────────────────────────────────────────┐
│  Your Claude Code session (the ORCHESTRATOR)           │
│  • Fetches /play.md                                    │
│  • POST /games → {id, watch_url, ingest_token}         │
│  • Spawns 6 piece-agent sub-agents in parallel per turn│
│  • Resolves negotiation strategy locally               │
│  • POSTs events + moves to backend                     │
│  • All LLM inference happens HERE (free for you)       │
└────────────────────────────────────────────────────────┘
                      ▲  HTTPS (bearer: ingest_token)
                      ▼
┌────────────────────────────────────────────────────────┐
│  AWS backend (api.chessminds — passive relay)          │
│  • CDK stack: API Gateway v2 + arm64 Lambda + DynamoDB │
│  • Validates moves authoritatively via python-chess    │
│  • Single-table event log, 7d TTL                      │
│  • Never calls an LLM                                  │
└────────────────────────────────────────────────────────┘
                      ▲  HTTPS + long-polling
                      ▼
┌────────────────────────────────────────────────────────┐
│  Vercel frontend (Next.js 16 App Router)               │
│  • /         landing                                   │
│  • /llms.txt AI discovery index (llmstxt.org)          │
│  • /play.md  agent bootstrap (text/markdown)           │
│  • /game/[id] live viewer — board + 12 agent cards +   │
│    streaming negotiation feed, polls /events every 1.5s│
└────────────────────────────────────────────────────────┘
```

Deeper design reasoning: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Repo layout

```
colabchess/
├── README.md                  this file
├── ARCHITECTURE.md            design deep-dive
├── requirement.md             original product spec
│
├── apps/
│   ├── web/                   Next.js 16 frontend (Vercel)  → apps/web/README.md
│   └── api/                   AWS Lambda handlers (Python)  → apps/api/README.md
│
├── infra/                     AWS CDK stack (TypeScript)    → infra/README.md
│
└── configs/                   starter YAML configs
```

Each package has its own README with commands + env vars.

---

## Local development

**Prerequisites.** Node 20+ (we use 23), Python 3.12 (pinned via `apps/api/.python-version`), `uv` for Python deps, `aws` CLI with creds if you'll deploy, Docker running for CDK Lambda bundling.

```bash
# Backend (Python)
cd apps/api
uv sync
uv run pytest -q       # 56 tests, ~3s

# Frontend (Node)
cd apps/web
npm install
npm run dev            # http://localhost:3001 (port 3000 is often taken locally)
npm run typecheck
npm run test           # 7 vitest tests

# Infra (CDK synth — no AWS creds needed)
cd infra
npm install
npx cdk synth
npm test               # 6 synth-assertion tests
```

---

## Deploy

**Backend (AWS).** From `infra/`:

```bash
npx cdk diff           # preview changes
npx cdk deploy         # ~45s; CDK bundles Lambda in Docker
```

Outputs include `ApiUrl` and `GameTableName`. Capture them for the frontend env:

```bash
export NEXT_PUBLIC_API_BASE="https://<apiUrl>"
```

**Frontend (Vercel).** From `apps/web/`:

```bash
vercel link --project chessminds --scope <your-scope>
vercel --yes            # preview deploy; first one becomes production
vercel alias set <preview-url> chessminds-psi.vercel.app
```

Environment variables to set on Vercel:
- `NEXT_PUBLIC_API_BASE` — your AWS API URL.
- `NEXT_PUBLIC_SITE_URL` — your public Vercel URL (e.g. `https://chessminds-psi.vercel.app`). Used when `/play.md` and `/llms.txt` render themselves.

---

## Status

| Milestone | State | Notes |
|---|---|---|
| Cut 1 — AWS backend | ✓ shipped | CDK + Lambda (arm64) + DynamoDB + HTTP API v2. 56 pytests + 6 CDK synth tests. Live curl smoke test passing. |
| Cut 2 — `/play.md` + landing | ✓ shipped | Anthropic-style landing, self-contained agent bootstrap (~12 KB), `/llms.txt` AI index. |
| Cut 3 — live viewer | ✓ shipped | react-chessboard + 12 agent cards + streaming feed with Framer Motion. Event-shape normalizer (7 vitest tests). |
| Cut 4 — breadth | in progress | All 9 negotiation strategies, 3 personality presets, trash-talk intensity, kill lines, Stockfish grounding. |

---

## Scope changes we've taken

These moved from the original `requirement.md`:

- **SSE dropped for v1** → client-side polling (GET `/events?since={seq}` every 1.5s). Chess turns take 20–60s, so imperceptible UX difference + far less Lambda complexity. See [ARCHITECTURE.md §4](./ARCHITECTURE.md#4-transport).
- **Stockfish deferred to Cut 4** → default `stockfish_mode: off`. Agents play from pure chess vibes; grounding becomes a Phase-2 enhancement.
- **Mode 1 only for v1** → Claude Code sub-agents. Multi-provider LiteLLM mode from `requirement.md` §3.2 is deferred.

---

## Contributing

No external contributors yet. If that changes, `CONTRIBUTING.md` will cover how to add personality presets (`apps/api/engine/personalities/*.yaml`), negotiation strategies (`apps/api/engine/negotiation/*.py`), and custom event types (`apps/web/lib/events.ts` + `/play.md` Section 10).

---

## License

Unlicensed for now; add one before anyone else ships games here.
