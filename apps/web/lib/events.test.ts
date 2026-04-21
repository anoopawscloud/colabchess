import { describe, it, expect } from "vitest";
import { normalizeProposal, normalizeMove, isMoveType } from "./events";
import type { BaseEvent } from "./types";

describe("normalizeProposal", () => {
  it("handles the flat shape actually emitted by the orchestrator", () => {
    const flat: BaseEvent = {
      seq: 3,
      turn: 1,
      type: "PROPOSAL",
      side: "white",
      group: "pawns",
      move: "e2e4",
      public_statement: "We advance our noble e-pawn.",
      reasoning: "Central pawn.",
      confidence: 95,
    } as BaseEvent;
    const p = normalizeProposal(flat);
    expect(p.side).toBe("white");
    expect(p.role).toBe("pawns");
    expect(p.move).toBe("e2e4");
    expect(p.publicStatement).toBe("We advance our noble e-pawn.");
    expect(p.confidence).toBe(95);
    expect(p.trashTalk).toBeNull();
  });

  it("handles the canonical nested shape from /play.md", () => {
    const nested: BaseEvent = {
      seq: 4,
      turn: 1,
      type: "PROPOSAL",
      side: "black",
      agent: "knights",
      proposal: {
        proposed_move: "g8f6",
        reasoning: "Develop.",
        public_statement: "Onward!",
        confidence: 72,
        trash_talk: "Your pawn is overrated.",
      },
    } as BaseEvent;
    const p = normalizeProposal(nested);
    expect(p.side).toBe("black");
    expect(p.role).toBe("knights");
    expect(p.move).toBe("g8f6");
    expect(p.publicStatement).toBe("Onward!");
    expect(p.confidence).toBe(72);
    expect(p.trashTalk).toBe("Your pawn is overrated.");
  });

  it("returns sensible empties when fields are missing", () => {
    const sparse: BaseEvent = {
      seq: 5,
      turn: 1,
      type: "PROPOSAL",
      side: "white",
    } as BaseEvent;
    const p = normalizeProposal(sparse);
    expect(p.role).toBe("");
    expect(p.move).toBe("");
    expect(p.publicStatement).toBe("");
    expect(p.confidence).toBeNull();
    expect(p.trashTalk).toBeNull();
  });

  it("prefers the nested proposal object over top-level fields when both exist", () => {
    const both: BaseEvent = {
      seq: 6,
      turn: 1,
      type: "PROPOSAL",
      side: "white",
      agent: "queen",
      move: "top-level-wrong",
      public_statement: "top-level-wrong",
      proposal: {
        proposed_move: "d1h5",
        public_statement: "The correct one.",
        confidence: 80,
      },
    } as BaseEvent;
    const p = normalizeProposal(both);
    expect(p.move).toBe("d1h5");
    expect(p.publicStatement).toBe("The correct one.");
  });
});

describe("normalizeMove", () => {
  it("marks server-written MOVE as canonical", () => {
    const e: BaseEvent = {
      seq: 10,
      turn: 1,
      type: "MOVE",
      side: "white",
      move: "e2e4",
      san: "e4",
      fen_after: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
    } as BaseEvent;
    const m = normalizeMove(e);
    expect(m.canonical).toBe(true);
    expect(m.san).toBe("e4");
    expect(m.fenAfter).toContain("4P3");
  });

  it("marks orchestrator-narrated MOVE_PLAYED as non-canonical", () => {
    const e: BaseEvent = {
      seq: 9,
      turn: 1,
      type: "MOVE_PLAYED",
      side: "white",
      move: "e2e4",
    } as BaseEvent;
    const m = normalizeMove(e);
    expect(m.canonical).toBe(false);
    expect(m.move).toBe("e2e4");
    expect(m.san).toBeNull();
    expect(m.fenAfter).toBeNull();
  });
});

describe("isMoveType", () => {
  it("accepts both MOVE and MOVE_PLAYED", () => {
    expect(isMoveType("MOVE")).toBe(true);
    expect(isMoveType("MOVE_PLAYED")).toBe(true);
    expect(isMoveType("PROPOSAL")).toBe(false);
  });
});
