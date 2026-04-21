# Chess of Minds

A chess game where every piece is an AI agent with its own personality, voice, and strategic opinions. Pieces negotiate, argue, and trash-talk their way to each move.

## Try it

Point Claude Code at one URL:

```
Use https://chessminds.vercel.app/play.md to start a chess game.
```

Claude Code will spin up a game, print a live watch URL, and play the match by spawning one sub-agent per piece-group. Watch the negotiation unfold in your browser. Full spec: `requirement.md`.

## Repo layout

```
apps/
  web/        Next.js 16 App Router (Vercel)
  api/        AWS Lambda Python handlers (+ engine/ specs)
infra/        AWS CDK (TypeScript)
configs/      starter YAML configs
```

Source of truth for product requirements: `requirement.md`.
Build plan: `~/.claude/plans/look-into-requirement-md-and-parallel-hoare.md`.

## Dev setup

See per-package READMEs (coming with Cut 2).
