# chessminds-web

Next.js 16 App Router frontend for Chess of Minds. Deploys to Vercel.

The frontend has one job: **read** state from the AWS backend and render it — both for AI agents (markdown + plain text routes) and for human spectators (chessboard + streaming feed). It has no backend logic of its own beyond proxying snapshots to the viewer.

Full design reasoning: [../../ARCHITECTURE.md](../../ARCHITECTURE.md).

---

## Routes

| Path | Rendering | Purpose |
|---|---|---|
| `/` | static | Landing page. Hero + copy-paste prompt block for Claude Code + three-step how-it-works. |
| `/llms.txt` | dynamic, `text/plain` | AI discovery index per [llmstxt.org](https://llmstxt.org/). Product summary, entrypoint link, API surface table. |
| `/play.md` | dynamic, `text/markdown` | **The critical file.** Self-contained agent bootstrap — ~12 KB of instructions Claude Code reads to run a full game. Canonical event schemas in Section 10. |
| `/game/[id]` | dynamic (SSR+CSR) | Live viewer. SSR renders the initial snapshot from `GET /games/{id}`; `<GameViewer>` client component polls `/events?since={seq}` every 1.5s for updates. |

---

## Component layout

```
apps/web/
├── app/
│   ├── layout.tsx              root layout, font variables, metadata
│   ├── page.tsx                landing (server)
│   ├── globals.css             tailwind + design tokens (paper / ink / ember)
│   ├── llms.txt/route.ts       AI index (Route Handler)
│   ├── play.md/route.ts        agent bootstrap (Route Handler) — see §10 for canonical events
│   └── game/[id]/page.tsx      server page that fetches snapshot then hands off to <GameViewer>
├── components/
│   ├── CopyableCommand.tsx     one-click copy prompt block used on landing
│   └── GameViewer.tsx          client component — board + 12 agent cards + streaming feed
├── lib/
│   ├── agents.ts               role → glyph / label / tailwind-accent mapping
│   ├── events.ts               normalizeProposal / normalizeMove (accepts canonical + orchestrator shapes)
│   ├── events.test.ts          vitest — 7 tests covering both shapes + edge cases
│   └── types.ts                Snapshot, BaseEvent, CanonicalEventType
├── next.config.mjs             adds text/markdown + text/plain headers + cache
├── tailwind.config.ts          paper #F4EEE3, ink #141413, ember #D97757
└── tsconfig.json               strict; @/* paths alias
```

---

## Design tokens

- `paper` `#F4EEE3` — warm off-white background.
- `ink` `#141413` — deep charcoal text.
- `ember` `#D97757` — warm-orange accent (CTAs, live pill, move confirmations).
- Typography: Fraunces (serif display), Inter (sans body), IBM Plex Mono (FENs, UCI, code blocks).

Inspired by anthropic.com / claude.ai — quiet, confident, lots of whitespace.

---

## Environment variables

All `NEXT_PUBLIC_*` so they reach the client for SSR + client-side polling.

| Var | Purpose | Default |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | AWS backend URL (no trailing slash) | `https://4ckgfcll2h.execute-api.us-east-1.amazonaws.com` |
| `NEXT_PUBLIC_SITE_URL` | Public domain of this Vercel deployment | `https://chessminds-psi.vercel.app` |

Set them in the Vercel project dashboard under Settings → Environment Variables. Both "Production" and "Preview" environments.

---

## Local development

```bash
# Install
npm install

# Dev server (port 3001 — 3000 is often taken locally)
npm run dev
# → http://localhost:3001

# Type-check
npm run typecheck

# Production build — must pass before deploy
npm run build

# Vitest — 7 tests
npm run test

# Lint
npm run lint
```

Hitting `/game/[id]` locally while pointed at the deployed AWS backend works — CORS is `*`. Create a game via curl first:

```bash
curl -X POST https://4ckgfcll2h.execute-api.us-east-1.amazonaws.com/games \
  -H "content-type: application/json" -d '{}'
# then open http://localhost:3001/game/{id}
```

---

## Deploy

Linked to Vercel under scope `anoopbhats-projects`, project `chessminds`. Public alias: `chessminds-psi.vercel.app`.

```bash
# Preview deploy — becomes production on first run
vercel --yes

# Promote a preview to the public alias
vercel alias set <preview-url>.vercel.app chessminds-psi.vercel.app
```

Any `git push` to a feature branch makes a Vercel preview but does NOT auto-alias to `-psi`. That's intentional — the alias only moves when we explicitly promote.

---

## Event normalization (why `/lib/events.ts` exists)

The orchestrator is a creative LLM. When `/play.md` describes a canonical event shape, Claude may flatten the nested `proposal` object or rename `agent` → `group`. We normalize both shapes to one internal model before rendering.

```ts
// canonical (what /play.md §10 specifies)
{ type: "PROPOSAL", agent: "knights", proposal: { proposed_move, public_statement, confidence } }

// flat (what the orchestrator sometimes actually emits)
{ type: "PROPOSAL", group: "knights", move, public_statement, confidence }
```

Both → `NormalizedProposal { role, move, publicStatement, confidence, ... }`. See `lib/events.test.ts` for fixtures covering both shapes + the "missing fields" edge case.

If you add a new event type, update:
1. `lib/events.ts` — add a normalizer if the shape warrants one.
2. `components/GameViewer.tsx::EventRow` — add a rendering branch.
3. `app/play.md/route.ts` §10 — document the canonical shape.
4. `lib/events.test.ts` — add fixtures.

---

## Viewer behavior

1. **Page load.** Server-side fetches `GET /games/{id}` (no CORS, server-to-server). Renders board + full event history immediately — no loading spinner.
2. **Client hydrates.** `<GameViewer>` takes over.
3. **Polling.** Every 1.5s it hits `GET /games/{id}/events?since={cursor}`. Empty response → no-op. Non-empty → append events, bump cursor, update FEN if a `MOVE` arrived.
4. **Connection health.** Any fetch error surfaces as a `conn error` pill in the header (tooltip shows the exact error). Console logs every failure. Recovery is automatic on the next successful tick.
5. **Game end.** When `status !== "ongoing"` comes back, polling stops. The feed/board remain rendered indefinitely.

---

## Deps (Cut 3)

- `react-chessboard@^5` — the board. Takes `position` (FEN); we never touch it beyond re-rendering.
- `chess.js@^1` — declared for future client-side parse needs; not currently imported.
- `framer-motion@^12` — layout + enter animations on feed rows.
- `clsx` + `tailwind-merge` — tiny class-composition helpers.

Everything else is Next.js, React 19, Tailwind, TypeScript.
