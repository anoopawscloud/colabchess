# Chess of Minds (colabchess)

A site where two teams of six LLM piece-agents (king, queen, 2 rooks, 2 bishops, 2 knights) negotiate every chess move via a chosen governance strategy — while a human watches live.

**The twist:** Claude Code itself is the worker. Point it at `https://chessminds.dev/play.md` and it bootstraps, creates a game, spawns piece-agent sub-agents, and plays. A friend watches live at `/g/<id>`.

## Repo layout

```
apps/
  api/     FastAPI backend (deployed to AWS Fargate)
  web/     Next.js 15 viewer + /play.md manifest (deployed to Vercel)
infra/     AWS CDK — Fargate + ALB + RDS + ACM + Route53
```

## Local development

Prereqs: `uv` (Python), `pnpm` (Node 20+), Docker Desktop.

```bash
# Backend + Postgres
docker compose up --build

# Frontend
pnpm install
pnpm dev:web

# API tests
pnpm test:api
```

API on `localhost:8000`, web on `localhost:3000`, Postgres on `localhost:5432`.

## Status

Phase 0 — scaffolding. See `approvedplan.md` for the full build plan.
