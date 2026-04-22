/**
 * Event normalization.
 *
 * The orchestrator (user's Claude Code session) sometimes posts PROPOSAL events
 * with a flat shape:
 *     {type, side, group, move, public_statement, reasoning, confidence}
 * and sometimes with the canonical nested shape:
 *     {type, side, agent, proposal: {proposed_move, public_statement, reasoning, confidence}}
 *
 * This module collapses both into one internal `NormalizedProposal` so the
 * viewer renders consistently regardless of which shape landed.
 */
import type { BaseEvent } from "./types";

export interface NormalizedProposal {
  seq: number;
  turn: number;
  side: "white" | "black";
  role: string; // normalized role key; may be empty if missing
  move: string; // UCI or "abstain" or ""
  publicStatement: string;
  reasoning: string;
  confidence: number | null;
  trashTalk: string | null;
}

export interface NormalizedMove {
  seq: number;
  turn: number;
  side: "white" | "black";
  move: string; // UCI
  san: string | null;
  fenAfter: string | null;
  canonical: boolean; // true if this was a server-written MOVE event; false for orchestrator narration
}

function getString(e: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = e[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function getNumber(e: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = e[k];
    if (typeof v === "number") return v;
  }
  return null;
}

export function isProposalType(type: string): boolean {
  return type === "PROPOSAL";
}

export function isMoveType(type: string): boolean {
  return type === "MOVE" || type === "MOVE_PLAYED";
}

/**
 * Collapse a PROPOSAL event (either canonical nested or flat) into one shape.
 * Missing fields become empty-string / null so the renderer can just write them.
 */
export function normalizeProposal(event: BaseEvent): NormalizedProposal {
  const e = event as unknown as Record<string, unknown>;
  const nested =
    e.proposal && typeof e.proposal === "object"
      ? (e.proposal as Record<string, unknown>)
      : {};

  const side = (getString(e, "side") || "white") as "white" | "black";
  const role = getString(e, "agent", "group", "role");
  const move = getString(nested, "proposed_move", "move") || getString(e, "move", "proposed_move");
  const publicStatement =
    getString(nested, "public_statement") || getString(e, "public_statement");
  const reasoning = getString(nested, "reasoning") || getString(e, "reasoning");
  const confidence = getNumber(nested, "confidence") ?? getNumber(e, "confidence");
  const trashTalk =
    getString(nested, "trash_talk") || getString(e, "trash_talk") || null;

  return {
    seq: event.seq,
    turn: event.turn,
    side,
    role,
    move,
    publicStatement,
    reasoning,
    confidence,
    trashTalk,
  };
}

/** Collapse a MOVE or MOVE_PLAYED event. */
export function normalizeMove(event: BaseEvent): NormalizedMove {
  const e = event as unknown as Record<string, unknown>;
  const side = (getString(e, "side") || "white") as "white" | "black";
  return {
    seq: event.seq,
    turn: event.turn,
    side,
    move: getString(e, "move", "san", "uci"),
    san: getString(e, "san") || null,
    fenAfter: getString(e, "fen_after") || null,
    canonical: event.type === "MOVE",
  };
}
