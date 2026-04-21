# chessminds-api

AWS Lambda Python handlers + shared engine specs for Chess of Minds.

The backend is a **passive relay**: it stores events, validates moves authoritatively via `python-chess`, and serves a polling/snapshot API. It never calls an LLM. All orchestration runs in the user's local Claude Code session — see [`/play.md`](../web/app/play.md/route.ts) for the agent-side protocol.

Full design reasoning: [../../ARCHITECTURE.md](../../ARCHITECTURE.md).

---

## Layout

```
apps/api/
├── pyproject.toml          uv + hatchling; declares runtime + dev deps
├── .python-version         3.12 (auto-provisioned by uv)
├── handlers/
│   └── api.py              Lambda entrypoint + Powertools HTTP resolver with all 5 routes
├── lib/
│   ├── db.py               GameRepo — DynamoDB single-table access (atomic seq, token hashing)
│   └── chess_rules.py      python-chess wrapper (apply_move, legal_moves_uci, GameStatus)
├── engine/
│   └── schemas.py          Pydantic models (Proposal, Event union, Config, API req/resp)
└── tests/                  pytest — 56 tests, ~3s total
    ├── test_schemas.py         schema round-trips + validators
    ├── test_chess_rules.py     move legality, mate/stalemate detection
    ├── test_db.py              moto-backed DDB unit tests (monotonic seq, TTL, token auth)
    └── test_handlers.py        full request/response cycle via synthetic APIGW events
```

---

## API surface

All routes live in one Lambda (`chessminds-api`) behind an API Gateway v2 HTTP API.

| Verb | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/games` | public, rate-limited | Create a game. Body `{"config": {...}}` optional. Returns `{id, watch_url, ingest_token, ttl_seconds}`. Writes a `GAME_CREATED` event. |
| GET  | `/games/{id}` | public | Full snapshot: `{id, fen, status, side_to_move, legal_moves, config, next_seq, events}`. |
| GET  | `/games/{id}/events?since={seq}` | public | Poll for events after `seq`. Returns `{events, next_seq, status}`. The viewer's heartbeat. |
| POST | `/games/{id}/events` | bearer `ingest_token` | Append an arbitrary event (proposal / debate / reaction / …). Server auto-assigns monotonic `seq`. |
| POST | `/games/{id}/move` | bearer `ingest_token` | Play a move. Body `{"move": "e2e4", "side": "white", "turn": 1}`. Server validates with python-chess; rejects illegal moves with 400. On success writes a `MOVE` event atomically. |

Every write returns JSON; every error is a Powertools-formatted JSON error.

Canonical event shapes the orchestrator should emit are enumerated in `/play.md` §10 — see the deployed site or `apps/web/app/play.md/route.ts`.

---

## Environment variables

Set by the CDK stack; override locally for testing.

| Var | Purpose | Default |
|---|---|---|
| `GAME_TABLE` | DynamoDB table name | (required) |
| `WATCH_URL_BASE` | Prefix used when composing `watch_url` in `POST /games` | `https://chessminds-psi.vercel.app/game` |
| `GAME_TTL_SECONDS` | Seconds until DynamoDB TTL sweeps the game | `604800` (7d) |
| `AWS_REGION` | Region for DDB client | auto in Lambda |

---

## Local development

```bash
# Install deps (creates .venv via uv; respects .python-version = 3.12)
uv sync

# Run the full test suite
uv run pytest -q

# Run just one file
uv run pytest tests/test_handlers.py -q

# Run with coverage
uv run pytest --cov=lib --cov=handlers --cov=engine

# Lint
uv run ruff check .
uv run ruff format .
```

There's no local dev server — the code runs as a Lambda handler. Tests invoke the handler with synthetic API Gateway v2 events; moto intercepts all DynamoDB traffic. See `tests/test_handlers.py::_event` for the event helper.

---

## Deploy

Handled by CDK. From `../../infra`:

```bash
npx cdk deploy
```

CDK bundles this package via Docker (`lambda.Runtime.PYTHON_3_12.bundlingImage` + `platform: linux/arm64`). Bundling command is:

```bash
pip install . --target /asset-output --no-cache-dir
```

Hatchling places `engine/`, `handlers/`, and `lib/` at the top of the output wheel. All runtime deps (python-chess, pydantic, aws-lambda-powertools, boto3) come along via `pip install`. Dev deps (pytest, moto, ruff) do not.

See [../../infra/README.md](../../infra/README.md) for the full stack.

---

## Testing gotchas we hit (keep in mind)

- **Powertools' `@logger.inject_lambda_context`** crashes when invoked with `context=None` (the default in tests). We don't use it in Cut 1 — if you add it back, synthesize a mock context.
- **v2 HTTP API events need more fields than you'd think.** Our helper adds `stage`, `requestId`, `routeKey`, `time`, `timeEpoch`, `accountId`, `apiId`, `domainName`, `domainPrefix` on `requestContext`. Missing any of these → `KeyError` from Powertools.
- **DynamoDB `sk BETWEEN "EVENT#00000001" AND "EVENT#99999999"`** is load-bearing. `sk > "EVENT#..."` also matches the `"META"` row alphabetically.

More in `~/.claude/statefiles/colabchess/state-learnings.md`.

---

## Schema reference

`engine/schemas.py` defines the authoritative Pydantic models. Used both at the handler boundary (best-effort validation of client payloads) and as the source of truth for the `/play.md` event shape spec.

- `Proposal` — what a piece-agent returns. UCI-validated.
- `Event` — discriminated union over all event types (`GAME_CREATED`, `TURN_STARTED`, `PROPOSAL`, `DEBATE`, `VOTE`, `MOVE`, `REACTION`, `KILL_LINE`, `RIVALRY_TICK`, `GAME_OVER`).
- `Config` — white/black `SideConfig` + `max_turns`.
- `SideConfig` — topology, personality preset, negotiation strategy, trash-talk intensity, stockfish mode, debate rounds.
- `CreateGameRequest` / `CreateGameResponse` — /games body + response.

The orchestrator is free to post custom event types beyond the canonical union (e.g. `AUCTION_RESULT`). The server stores them; the viewer renders them as "type + truncated JSON" if no specific handler exists.
