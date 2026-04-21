export interface Proposal {
  proposed_move: string;
  reasoning: string;
  public_statement: string;
  confidence: number;
  trash_talk?: string | null;
}

/**
 * Canonical event types. The orchestrator may emit additional custom types
 * (e.g. MOVE_PLAYED, AUCTION_RESULT) so we keep `type` as a plain string —
 * narrowing still works on string-literal checks.
 */
export type CanonicalEventType =
  | "GAME_CREATED"
  | "TURN_STARTED"
  | "PROPOSAL"
  | "DEBATE"
  | "VOTE"
  | "MOVE"
  | "REACTION"
  | "KILL_LINE"
  | "RIVALRY_TICK"
  | "GAME_OVER";

export interface BaseEvent {
  seq: number;
  turn: number;
  type: CanonicalEventType | string;
  [key: string]: unknown;
}

export interface Snapshot {
  id: string;
  fen: string;
  status: string;
  config: {
    white?: { personality_preset?: string; negotiation_strategy?: string };
    black?: { personality_preset?: string; negotiation_strategy?: string };
    max_turns?: number;
  };
  next_seq: number;
  events: BaseEvent[];
}
