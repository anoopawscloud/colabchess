/**
 * Turn grouping.
 *
 * The API returns events in a flat chronological list. To make the viewer
 * comprehensible, we group them into Turn objects — one per (turn, side)
 * pair — where each turn has distinct phases:
 *
 *   1. header       (TURN_STARTED, if emitted by the orchestrator)
 *   2. proposals    (PROPOSAL events — one per piece-agent)
 *   3. debate       (DEBATE events, multi-round strategies only)
 *   4. result       (AUCTION_RESULT / VOTE / CONSENSUS_REACHED)
 *   5. move         (canonical MOVE event — closes the turn)
 *   6. reactions    (REACTION / KILL_LINE events after the move)
 *
 * A canonical MOVE event ends the turn. Anything between two MOVEs belongs
 * to the turn that follows. The orchestrator's custom MOVE_PLAYED narration
 * events are kept in `narration` so they're visible but don't close turns.
 */
import type { BaseEvent } from "./types";

export type Side = "white" | "black";

export interface Turn {
  key: string; // stable React key: `${turn}-${side}`
  turn: number;
  side: Side | null;
  header?: BaseEvent; // TURN_STARTED
  proposals: BaseEvent[]; // PROPOSAL
  debate: BaseEvent[]; // DEBATE
  result?: BaseEvent; // AUCTION_RESULT / VOTE / CONSENSUS_REACHED
  move?: BaseEvent; // canonical MOVE
  narration: BaseEvent[]; // MOVE_PLAYED + misc before the move
  reactions: BaseEvent[]; // REACTION / KILL_LINE after the move
  complete: boolean; // true once we've seen the closing MOVE
}

export interface GroupedEvents {
  opening?: BaseEvent; // GAME_CREATED
  turns: Turn[];
  gameOver?: BaseEvent; // GAME_OVER
  unbucketed: BaseEvent[]; // anything we couldn't place (should be rare)
}

function getSide(e: BaseEvent): Side | null {
  const s = (e as Record<string, unknown>).side;
  return s === "white" || s === "black" ? s : null;
}

function blankTurn(turn: number, side: Side | null): Turn {
  return {
    key: `${turn}-${side ?? "x"}`,
    turn,
    side,
    proposals: [],
    debate: [],
    narration: [],
    reactions: [],
    complete: false,
  };
}

const RESULT_TYPES = new Set(["AUCTION_RESULT", "VOTE", "CONSENSUS_REACHED", "DEBATE_RESULT"]);
const REACTION_TYPES = new Set(["REACTION", "KILL_LINE", "RIVALRY_TICK"]);

export function groupIntoTurns(events: BaseEvent[]): GroupedEvents {
  const out: GroupedEvents = { turns: [], unbucketed: [] };
  let current: Turn | null = null;

  const flush = () => {
    if (current) {
      out.turns.push(current);
      current = null;
    }
  };

  for (const e of events) {
    const t = e.type;

    if (t === "GAME_CREATED") {
      out.opening = e;
      continue;
    }

    if (t === "GAME_OVER") {
      flush();
      out.gameOver = e;
      continue;
    }

    const side = getSide(e);

    if (t === "TURN_STARTED") {
      // A new turn starts. If we were in the middle of a turn with no MOVE
      // yet, close it anyway — the orchestrator moved on without flushing.
      flush();
      current = blankTurn(e.turn, side);
      current.header = e;
      continue;
    }

    if (t === "MOVE") {
      // The canonical MOVE event closes the turn.
      if (!current) {
        current = blankTurn(e.turn, side);
      }
      // If the event's turn/side don't match the currently-open turn,
      // trust the event and open a fresh turn first.
      if (
        current.turn !== e.turn ||
        (side && current.side && current.side !== side)
      ) {
        flush();
        current = blankTurn(e.turn, side);
      }
      current.move = e;
      current.complete = true;
      flush();
      continue;
    }

    if (!current) {
      current = blankTurn(e.turn, side);
    }

    if (t === "PROPOSAL") {
      current.proposals.push(e);
    } else if (t === "DEBATE") {
      current.debate.push(e);
    } else if (RESULT_TYPES.has(t)) {
      current.result = e;
    } else if (REACTION_TYPES.has(t)) {
      // Reactions usually happen after the move. They're rare during the
      // proposal/decision phase. Keep them on the current (or last) turn.
      if (current.complete) {
        current.reactions.push(e);
      } else {
        current.reactions.push(e);
      }
    } else {
      // MOVE_PLAYED or unknown custom types — keep as narration so they
      // stay visible without closing the turn.
      current.narration.push(e);
    }
  }

  flush();
  return out;
}

/**
 * For an auction result event, extract the winning role ("knights" etc.)
 * so the UI can highlight the winning proposal. Tolerant of different
 * orchestrator shapes.
 */
export function auctionWinner(result: BaseEvent | undefined): string | null {
  if (!result) return null;
  const e = result as unknown as Record<string, unknown>;
  const w =
    (typeof e.winner === "string" && e.winner) ||
    (typeof e.agent === "string" && e.agent) ||
    (typeof e.group === "string" && e.group) ||
    null;
  return w;
}
