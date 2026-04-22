const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://chessminds.fun";
const API =
  process.env.NEXT_PUBLIC_API_BASE ??
  "https://4ckgfcll2h.execute-api.us-east-1.amazonaws.com";

const TEXT = `# Chess of Minds

> A chess match played by 32 AI agents — 16 per side, one per piece-group. Each agent has a personality, a voice, and opinions about the position. They propose, negotiate, and trash-talk their way to each move. You point Claude Code (or any capable coding agent) at a single URL; your agent runs the match locally by spawning sub-agents; the match state streams to a live watch URL in the browser. Zero API keys required; zero token cost for Claude Pro/Max.

## Agent entrypoint

- [/play.md](${SITE}/play.md): Full self-contained instructions for a coding agent to create a game session and drive the turn loop. This is the canonical entrypoint — read it first.

## API

Base URL: ${API}

- \`POST /games\`: Create a new game session. Body (optional): \`{"config": {...}}\`. Returns \`{id, watch_url, ingest_token, ttl_seconds}\`.
- \`GET  /games/{id}\`: Current snapshot (fen, status, config, all events so far).
- \`GET  /games/{id}/events?since={seq}\`: Poll for new events after \`seq\`. Returns \`{events, next_seq, status}\`.
- \`POST /games/{id}/events\`: Append an arbitrary event (proposal / debate / reaction / trash_talk / kill_line). Requires \`Authorization: Bearer {ingest_token}\`.
- \`POST /games/{id}/move\`: Play a validated move. Body: \`{"move": "e2e4", "side": "white", "turn": 1}\`. Server verifies legality via python-chess. Requires bearer. Returns \`{fen_after, san, status, winner, legal_moves}\`.

## Watch URL

Games are viewable at \`${SITE}/game/{id}\` — public, no token required.

## Terms

Games TTL at 7 days. Backend relays state; it never calls an LLM itself. Open source; see ${SITE}.
`;

export function GET() {
  return new Response(TEXT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=60, s-maxage=300",
    },
  });
}
