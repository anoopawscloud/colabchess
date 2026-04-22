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

export type GameMode = "ai_vs_ai" | "human_vs_ai";

export interface Snapshot {
  id: string;
  fen: string;
  status: string;
  side_to_move?: "white" | "black";
  legal_moves?: string[];
  mode?: GameMode;
  human_plays?: "white" | "black" | null;
  config: {
    white?: { personality_preset?: string; negotiation_strategy?: string };
    black?: { personality_preset?: string; negotiation_strategy?: string };
    max_turns?: number;
    mode?: GameMode;
    human_plays?: "white" | "black" | null;
  };
  next_seq: number;
  events: BaseEvent[];
}
