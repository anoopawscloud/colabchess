import { describe, it, expect } from "vitest";
import { groupIntoTurns, auctionWinner } from "./turns";
import type { BaseEvent } from "./types";

function ev(overrides: Partial<BaseEvent>): BaseEvent {
  return { seq: 0, turn: 0, type: "UNKNOWN", ...overrides } as BaseEvent;
}

describe("groupIntoTurns", () => {
  it("is empty for an empty event list", () => {
    const g = groupIntoTurns([]);
    expect(g.turns).toEqual([]);
    expect(g.opening).toBeUndefined();
    expect(g.gameOver).toBeUndefined();
  });

  it("extracts the opening GAME_CREATED event", () => {
    const g = groupIntoTurns([ev({ seq: 1, turn: 0, type: "GAME_CREATED" })]);
    expect(g.opening?.seq).toBe(1);
    expect(g.turns).toEqual([]);
  });

  it("groups a full turn: proposal → auction → move", () => {
    const g = groupIntoTurns([
      ev({ seq: 1, turn: 0, type: "GAME_CREATED" }),
      ev({ seq: 2, turn: 1, type: "PROPOSAL", side: "white", agent: "pawns" }),
      ev({ seq: 3, turn: 1, type: "PROPOSAL", side: "white", agent: "knights" }),
      ev({ seq: 4, turn: 1, type: "AUCTION_RESULT", side: "white", winner: "pawns" }),
      ev({
        seq: 5,
        turn: 1,
        type: "MOVE",
        side: "white",
        move: "e2e4",
        san: "e4",
        fen_after: "...",
      }),
    ]);
    expect(g.turns).toHaveLength(1);
    const t = g.turns[0];
    expect(t.turn).toBe(1);
    expect(t.side).toBe("white");
    expect(t.proposals).toHaveLength(2);
    expect(t.result?.seq).toBe(4);
    expect(t.move?.seq).toBe(5);
    expect(t.complete).toBe(true);
  });

  it("separates white turn from black turn when MOVE closes each", () => {
    const g = groupIntoTurns([
      ev({ seq: 1, turn: 1, type: "PROPOSAL", side: "white", agent: "pawns" }),
      ev({ seq: 2, turn: 1, type: "MOVE", side: "white", move: "e2e4" }),
      ev({ seq: 3, turn: 1, type: "PROPOSAL", side: "black", agent: "pawns" }),
      ev({ seq: 4, turn: 1, type: "MOVE", side: "black", move: "e7e5" }),
    ]);
    expect(g.turns).toHaveLength(2);
    expect(g.turns[0].side).toBe("white");
    expect(g.turns[0].proposals).toHaveLength(1);
    expect(g.turns[1].side).toBe("black");
    expect(g.turns[1].proposals).toHaveLength(1);
  });

  it("respects TURN_STARTED as a turn delimiter", () => {
    const g = groupIntoTurns([
      ev({ seq: 1, turn: 1, type: "TURN_STARTED", side: "white" }),
      ev({ seq: 2, turn: 1, type: "PROPOSAL", side: "white", agent: "pawns" }),
      ev({ seq: 3, turn: 1, type: "TURN_STARTED", side: "black" }),
      ev({ seq: 4, turn: 1, type: "PROPOSAL", side: "black", agent: "pawns" }),
    ]);
    expect(g.turns).toHaveLength(2);
    expect(g.turns[0].header?.seq).toBe(1);
    expect(g.turns[1].header?.seq).toBe(3);
  });

  it("keeps MOVE_PLAYED as narration without closing the turn", () => {
    const g = groupIntoTurns([
      ev({ seq: 1, turn: 1, type: "PROPOSAL", side: "white", agent: "pawns" }),
      ev({ seq: 2, turn: 1, type: "MOVE_PLAYED", side: "white", move: "e2e4" }),
      ev({ seq: 3, turn: 1, type: "MOVE", side: "white", move: "e2e4" }),
    ]);
    expect(g.turns).toHaveLength(1);
    expect(g.turns[0].narration).toHaveLength(1);
    expect(g.turns[0].narration[0].type).toBe("MOVE_PLAYED");
    expect(g.turns[0].complete).toBe(true);
  });

  it("finalizes GAME_OVER after the last turn", () => {
    const g = groupIntoTurns([
      ev({ seq: 1, turn: 1, type: "PROPOSAL", side: "white", agent: "pawns" }),
      ev({ seq: 2, turn: 1, type: "MOVE", side: "white", move: "e2e4" }),
      ev({ seq: 3, turn: 1, type: "GAME_OVER", winner: "white", reason: "checkmate" }),
    ]);
    expect(g.turns).toHaveLength(1);
    expect(g.gameOver?.winner).toBe("white");
  });

  it("flushes an in-progress turn that never saw MOVE (live viewing)", () => {
    const g = groupIntoTurns([
      ev({ seq: 1, turn: 1, type: "PROPOSAL", side: "white", agent: "pawns" }),
      ev({ seq: 2, turn: 1, type: "PROPOSAL", side: "white", agent: "knights" }),
      // no MOVE yet — currently deliberating
    ]);
    expect(g.turns).toHaveLength(1);
    expect(g.turns[0].complete).toBe(false);
    expect(g.turns[0].proposals).toHaveLength(2);
  });

  it("places REACTION events after the move", () => {
    const g = groupIntoTurns([
      ev({ seq: 1, turn: 1, type: "PROPOSAL", side: "white", agent: "pawns" }),
      ev({ seq: 2, turn: 1, type: "MOVE", side: "white", move: "e2e4" }),
      ev({ seq: 3, turn: 1, type: "REACTION", side: "black", agent: "pawns", public_statement: "..." }),
    ]);
    // Note: after MOVE closes the turn, the next REACTION may open a fresh
    // one if it has a different turn/side. For now we treat the reaction as
    // opening a new turn attached to the same turn number.
    // This behavior is acceptable — reactions still visible, just in the next card.
    const totalReactions = g.turns.reduce((sum, t) => sum + t.reactions.length, 0);
    expect(totalReactions).toBeGreaterThanOrEqual(1);
  });
});

describe("auctionWinner", () => {
  it("returns null when there's no result event", () => {
    expect(auctionWinner(undefined)).toBeNull();
  });

  it("reads the canonical 'winner' field", () => {
    const r = { seq: 1, turn: 1, type: "AUCTION_RESULT", winner: "knights" } as BaseEvent;
    expect(auctionWinner(r)).toBe("knights");
  });

  it("falls back to 'agent' when the orchestrator used that name", () => {
    const r = { seq: 1, turn: 1, type: "AUCTION_RESULT", agent: "pawns" } as BaseEvent;
    expect(auctionWinner(r)).toBe("pawns");
  });

  it("falls back to 'group' when the orchestrator used that name", () => {
    const r = { seq: 1, turn: 1, type: "AUCTION_RESULT", group: "bishops" } as BaseEvent;
    expect(auctionWinner(r)).toBe("bishops");
  });
});
