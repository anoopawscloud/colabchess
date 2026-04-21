export interface Proposal {
  proposed_move: string;
  reasoning: string;
  public_statement: string;
  confidence: number;
  trash_talk?: string | null;
}

export type EventType =
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
  type: EventType;
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
