# Architecture

Design reasoning behind Chess of Minds. The top-level [README](./README.md) covers the what and how; this file covers the **why**.

Scope: current code, not aspirational roadmap. When the code and this doc diverge, the code wins — please update this doc in the same PR.

---

## 1. The single principle

**The user's coding-agent IS the game engine. The cloud is stage and spotlight.**

Every LLM call happens inside the user's local Claude Code session. The AWS backend holds state, validates moves, and streams events to watchers. The Vercel frontend renders the game. Neither ever calls an LLM. This is the load-bearing choice from which the rest of the architecture falls out.

Consequences we accept:

- A full game costs $0 at the token level for Claude Pro/Max subscribers (the whole point of the product).
- Game length is bounded by the user's plan message limits, not dollars.
- We cannot do cross-provider mixing in v1 (that's Mode 2, deferred).
- The user's session must stay alive for the game to progress; if they close Claude Code mid-match, the game orphans (resumable view, not resumable play).

---

## 2. Three layers

```
┌───────────────────────────────────────────────┐
│ Orchestrator — the user's Claude Code session │
│   fetches /play.md                            │
│   spawns piece-agent sub-agents via Task tool │
│   runs negotiation strategy locally           │
│   POSTs events + moves                        │
└───────────────────────────────────────────────┘
                      ↕ HTTPS
┌───────────────────────────────────────────────┐
│ Backend — AWS: relay + validator              │
│   API Gateway v2 (HTTP API)                   │
│   Lambda (Python 3.12, arm64, 512 MB, 10s)    │
│   DynamoDB single-table (PK/SK, 7d TTL)       │
└───────────────────────────────────────────────┘
                      ↕ HTTPS (polling)
┌───────────────────────────────────────────────┐
│ Frontend — Vercel: reader                     │
│   Next.js 16 App Router                       │
│   SSR initial snapshot; CSR polling thereafter│
└───────────────────────────────────────────────┘
```

Each layer knows nothing about the others beyond the HTTP contract. You could swap any one of them (Python FastAPI backend on Fargate instead of Lambda; a Go frontend instead of Next; a different coding-agent instead of Claude Code) without touching the other two.

The HTTP contract is documented in `/llms.txt` at the deployed site, so a machine reader can discover it.

---

## 3. Why Mode 1 only (for v1)

The original spec (`requirement.md` §3) proposed two execution modes: Mode 1 (Claude Code sub-agents, zero cost) and Mode 2 (multi-provider LiteLLM, real $$). We picked Mode 1 for v1.

Arguments for Mode 1 first:
- Matches the "paste one URL into Claude Code" UX the product is selling.
- Zero ops: no LLM API keys ever touch the backend.
- Zero infra risk: backend is stateless relay; misconfigured prompts burn no budget.
- Personality is the differentiator, not model selection — if we can't get a watchable game with one model + good prompts, adding mixed providers won't save us.

Honest trade-off: you lose the "thinking texture" diversity of GPT-vs-Grok-vs-Gemini. Well-crafted personality prompts cover ~80% of that gap in practice.

Mode 2 isn't removed from the architecture — the backend contract (`POST /games/{id}/events`, `POST /games/{id}/move`) is provider-agnostic. A future Mode 2 runner would post to the same endpoints from a Python/FastAPI service.

---

## 4. Transport

### 4.1 Why polling, not SSE

Original design called for SSE with a streaming-response Lambda. We dropped that for v1. A chess turn resolves in 20–60 seconds (six piece-agents deliberate in parallel). The human-perceptible difference between SSE pushing and the client polling `GET /events?since={seq}` every 1.5s is zero. Polling buys us:

- No Lambda response-streaming + 15-min cap dance.
- No client reconnect logic on every Lambda recycle.
- Works through any proxy/CDN without config.
- One Lambda handler instead of two.

If a real latency need shows up later (e.g. a spectator chat layer with <1s expectations), the event schema is unchanged — swap the transport without touching the data.

### 4.2 Client polling loop

`apps/web/components/GameViewer.tsx` maintains:
- `cursor` — the last `seq` seen by this client.
- `events` — the full list so far (seeded by SSR snapshot).
- `snapshot.fen` — updated when a MOVE event arrives.

Every 1.5s it calls `GET /games/{id}/events?since={cursor}`. Non-empty responses append to state and bump the cursor. Fetch errors set a `conn error` pill in the header (with the error in a tooltip); recovery happens automatically on the next successful tick.

### 4.3 CORS

The API Gateway stack allows `AllowOrigins: ["*"]` with no credentials. This is safe because:

- Writes are bearer-token-gated (the `ingest_token` returned at game creation). Origin is irrelevant.
- Reads are public by design (the whole product is "share this URL, friends watch").
- No cookies, no session auth, no CSRF surface.

If we ever add credentialed auth, we'd swap to an explicit allowlist + `AllowCredentials: true`. For now `*` keeps the preview-URL churn from becoming an ops burden every time Vercel assigns a new preview domain.

---

## 5. Data model

### 5.1 Single-table DynamoDB

One table (`chessminds-games`), two row kinds:

| PK | SK | Attributes |
|---|---|---|
| `GAME#{id}` | `META` | `game_id`, `config_json`, `watch_url`, `token_hash`, `current_fen`, `status`, `next_seq`, `created_at`, `expires_at` |
| `GAME#{id}` | `EVENT#{seq:08d}` | `type`, `turn`, `seq`, `expires_at`, …event-specific fields |

Both rows carry `expires_at` (Unix epoch). DynamoDB TTL sweeps them after 7 days.

Reads fan out via:
- `GetItem(PK, "META")` for game metadata.
- `Query(PK, SK BETWEEN "EVENT#{since+1:08d}" AND "EVENT#99999999")` for events since cursor.

The `BETWEEN` is load-bearing — a naive `SK > "EVENT#..."` also matches `"META"` lexicographically and returns the metadata row as if it were an event.

### 5.2 Monotonic sequence

Event ordering matters for both polling and replay. We use DynamoDB's atomic `ADD` on the META row's `next_seq` counter:

```python
resp = table.update_item(
    Key={"pk": _pk(game_id), "sk": "META"},
    UpdateExpression="ADD next_seq :one",
    ConditionExpression="attribute_exists(pk)",
    ExpressionAttributeValues={":one": 1},
    ReturnValues="UPDATED_NEW",
)
seq = int(resp["Attributes"]["next_seq"])
```

That gives us a server-generated `seq`. We then PutItem the event row under `EVENT#{seq:08d}`. If the PutItem fails, the counter is already incremented — we get a gap, not a duplicate. Acceptable trade-off at our volume (single-writer-per-game enforced by the bearer token).

### 5.3 Ingest token

Returned once at `POST /games`. Used as `Authorization: Bearer {token}` on write endpoints (`/events`, `/move`). Stored as a SHA-256 hash on the META row; compared with `hmac.compare_digest` to avoid timing-based extraction. Losing the token orphans writes but viewing continues to work — a deliberate "capability URL" design.

---

## 6. Event schema — canonical vs tolerant

The orchestrator is a creative LLM. When `/play.md` says

> "POST an event of type `PROPOSAL` with an `agent` field and a nested `proposal` object"

the LLM may decide `group` is a more natural key than `agent`, or that flattening the nested `proposal` object is cleaner. In practice that happens. We hit it in a real session on game `oo0UxI4D` — every row rendered as "· white → ''" until we fixed it.

Resolution has two parts:

**Strict spec, lenient reader.**

1. `apps/web/app/play.md/route.ts` Section 10 now specifies exact canonical JSON for every event type, with a hard rule banning renames and type-name inventions.
2. `apps/web/lib/events.ts` exports `normalizeProposal` and `normalizeMove` that accept BOTH the canonical shape AND the flattened/renamed shapes the orchestrator tends to emit. Unit-tested in `events.test.ts` against real production event data.

The viewer never trusts shape assumptions. It asks the normalizer for a `NormalizedProposal`, which always has `role`, `move`, `publicStatement`, etc. — even when input fields are missing.

**Canonical event types the orchestrator should emit:**

- `PROPOSAL`, `DEBATE`, `VOTE`, `REACTION`, `KILL_LINE`, `TURN_STARTED`, `AUCTION_RESULT`, `GAME_OVER` — orchestrator posts via `/events`.
- `GAME_CREATED`, `MOVE` — server writes automatically on `POST /games` and `POST /move`. The orchestrator should NOT post these; doing so creates duplicates and loses server-side validation.

Unknown custom types (the orchestrator's creative inventions) render as `{type}` plus a truncated JSON preview rather than being silently dropped — so debugging is always possible from the viewer alone.

---

## 7. Lambda packaging

### 7.1 arm64 + Docker bundling

Lambda defaults to `x86_64`, but we run on `arm64` (AWS Graviton) because:

1. Matches our Mac dev machines → `pip install` in the bundling container pulls ARM wheels natively.
2. ~20% cheaper per GB-second.
3. No meaningful performance difference for our Python handler.

If we deployed x86 Lambdas on an ARM host without care, the bundler would produce a zip containing aarch64 `pydantic_core._pydantic_core.so`, which would fail at Lambda cold-start with `ImportModuleError`. We've been bitten by this (see `state-learnings.md`), hence the explicit:

```ts
architecture: lambda.Architecture.ARM_64,
bundling: {
  image: lambda.Runtime.PYTHON_3_12.bundlingImage,
  platform: "linux/arm64",
  command: ["bash", "-c", "pip install . --target /asset-output --no-cache-dir"],
},
```

If you're building on a non-ARM host, set `platform: "linux/arm64"` anyway — Docker QEMU-emulates cross-platform pulls transparently (slower but correct).

### 7.2 Hatchling-driven `pip install .`

`apps/api/pyproject.toml` uses `hatchling` as the build backend with:

```toml
[tool.hatch.build.targets.wheel]
packages = ["engine", "handlers", "lib"]
```

So `pip install .` produces a wheel containing those three directories + their dependencies, all placed under `/asset-output`. The Lambda handler is `handlers.api.handler`, which the runtime resolves from the top level of the zip.

No `requirements.txt` maintenance, no dev deps in the zip, no monorepo-specific Python packaging gymnastics.

---

## 8. Viewer rendering

### 8.1 SSR then CSR

`/game/[id]/page.tsx` is a React Server Component. At request time:

1. Server-side fetch of `GET /games/{id}` — no CORS (server-to-server).
2. Pass snapshot as a prop to `<GameViewer>` (a client component).
3. `<GameViewer>` starts polling for new events from the browser.

This means the first paint is populated with the full event history at load time — fast, no loading spinner, even on long games. Subsequent updates are live via polling.

### 8.2 Board component

`react-chessboard` v5 takes a `position` (FEN) and re-renders when it changes. We do nothing fancy: when the client polls and sees a `MOVE` event with `fen_after`, we `setSnapshot(s => ({...s, fen: lastMove.fen_after}))` and the board updates.

Framer Motion wraps the feed rows with `<AnimatePresence>` + staggered `opacity/y` animation so new events fade in rather than pop.

### 8.3 Agent cards

`deriveAgents(events)` pure-function replays the event log to produce a per-role state (last statement, last proposed move, confidence). Called inside `useMemo` so it only runs when events change. Derived from `events`, not stored — a reload rebuilds the same UI from the same log.

---

## 9. `/play.md` as the product's spine

The single most important file in the repo is `apps/web/app/play.md/route.ts`. It serves the markdown that Claude Code reads on first fetch.

It is **~12 KB**, **self-contained**, and rewritten to be:

- **Opinionated**: defaults the user probably wants (grouped topology, auction strategy, medieval-serious preset, `stockfish_mode: off`).
- **Concrete**: exact JSON examples for every API call and event type.
- **Defensive**: hard rules forbidding the common orchestrator mistakes (pip install, type-name invention, flattening the proposal object).
- **Humble**: if a move is illegal server-side, trust the server; the LLM was wrong.

Changes to `/play.md` should pair with changes to the viewer's normalizer — if you teach the orchestrator a new event type, teach the viewer how to render it and add a vitest case.

---

## 10. Trade-offs explicitly accepted

1. **Orphaned games if orchestrator crashes.** Ingest token lives only in the orchestrator's session memory. If Claude Code is closed mid-game, the game is viewable but not resumable. Acceptable at v1 scale. Fix path: `POST /games/{id}/resume` keyed by a refresh token.
2. **Polling burns more requests than SSE** — ~40/min per viewer. DDB read cost is trivial at expected load; Lambda invocations are trivial too. Pay it; revisit if we ever have 10k concurrent viewers.
3. **`*` CORS** — simpler than maintaining an allowlist of Vercel preview URLs. Safe because writes are bearer-token gated and no credentials are sent.
4. **Short Vercel URL** — `chessminds.vercel.app` was taken by another project. We use `chessminds-psi.vercel.app` via Vercel's auto-assigned alias. Custom domain is a single `NEXT_PUBLIC_SITE_URL` + `WATCH_URL_BASE` swap away.
5. **7-day TTL on games.** Replays are ephemeral. Long-term replay storage (Phase 3 in `requirement.md`) deferred.
6. **No spectator chat, no Twitch integration, no voice synthesis.** All stretch.

---

## 11. Testing pyramid

| Layer | Tool | Count | What it guards |
|---|---|---|---|
| Python units | pytest | 56 | Schemas, chess rules, DB ops, handler logic |
| Python HTTP integration | pytest + moto | (subset of above) | End-to-end handler path with mocked DDB |
| TS units | vitest | 7 | Event normalization (both canonical + orchestrator shapes) |
| CDK synth | jest + `@aws-cdk/assertions` | 6 | Stack structure, CORS, IAM scope, routes |
| Live smoke | bash + curl | 7 | Deployed API end-to-end |
| End-to-end orchestration | manual Claude Code session | ongoing | `/play.md` → real game → viewer updates |

The first four run in <10s locally. The live smoke runs against the deployed stack and is idempotent — safe to loop.

No selenium / Playwright / browser tests yet. When the viewer gains interactive features (Cut 4+), add them.

---

## 12. What ships where

| Change | Rebuild needed |
|---|---|
| Python handler / schema / chess rules | `cdk deploy` from `infra/` (re-bundles Lambda) |
| CDK stack (table, routes, CORS) | `cdk deploy` |
| Next.js pages / components | `vercel --yes` from `apps/web/` |
| `/play.md` content | `vercel --yes` (it's a route handler, not a static file) |

The two deploys are independent. Touching one layer rarely requires touching the other.

---

## 13. References

- Product spec: `requirement.md`
- Agent bootstrap: `apps/web/app/play.md/route.ts` (served at `/play.md`)
- Approved plan: `~/.claude/plans/look-into-requirement-md-and-parallel-hoare.md`
- State files (session memory): `~/.claude/statefiles/colabchess/`
