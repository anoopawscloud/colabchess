# chessminds-api

AWS Lambda Python handlers + shared engine specs for Chess of Minds.

## Layout

- `handlers/` — one file per Lambda entry (create_game, play_move, append_event, snapshot, stream, analyze).
- `lib/` — shared helpers (db, chess_rules, auth).
- `engine/` — Pydantic schemas, negotiation strategy specs, personality presets, prompt templates.
- `tests/` — pytest. Must stay green.

## Dev

```
uv sync          # install runtime + dev deps into .venv
uv run pytest -q # run tests
uv run ruff check .
```

## Deploy

Built as Lambda zips by CDK (see `../../infra`). Run `cdk deploy` from `infra/`.
