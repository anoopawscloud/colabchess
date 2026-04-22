"""Pydantic schemas for Chess of Minds.

Proposal, Event (discriminated union), Config, and API request/response models.
Used by Lambda handlers for incoming validation AND by /play.md generation
for the exact prompt templates piece-agents must follow.
"""
from __future__ import annotations

import re
from enum import Enum
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, RootModel, field_validator


UCI_RE = re.compile(r"^[a-h][1-8][a-h][1-8][qrbn]?$")


class Topology(str, Enum):
    GROUPED = "grouped"
    INDIVIDUAL = "individual"


class NegotiationStrategy(str, Enum):
    DEMOCRACY = "democracy"
    MONARCHY = "monarchy"
    AUCTION = "auction"
    DEBATE = "debate"
    CONSENSUS = "consensus"
    HIERARCHY = "hierarchy"
    PERSONALITY = "personality"
    ROTATING = "rotating"
    ANARCHY = "anarchy"


class PersonalityPreset(str, Enum):
    MEDIEVAL_SERIOUS = "medieval_serious"
    SHAKESPEAREAN_TRAGEDY = "shakespearean_tragedy"
    MODERN_OFFICE = "modern_office"


class TrashTalkIntensity(str, Enum):
    NONE = "none"
    MILD = "mild"
    SPICY = "spicy"
    UNHINGED = "unhinged"


class StockfishMode(str, Enum):
    OFF = "off"
    ADVISORY = "advisory"
    REQUIRED = "required"


class EventType(str, Enum):
    GAME_CREATED = "GAME_CREATED"
    TURN_STARTED = "TURN_STARTED"
    PROPOSAL = "PROPOSAL"
    DEBATE = "DEBATE"
    VOTE = "VOTE"
    MOVE = "MOVE"
    REACTION = "REACTION"
    KILL_LINE = "KILL_LINE"
    RIVALRY_TICK = "RIVALRY_TICK"
    GAME_OVER = "GAME_OVER"


class Proposal(BaseModel):
    model_config = ConfigDict(frozen=True)

    proposed_move: str = Field(description="UCI move string or 'abstain'.")
    reasoning: str = Field(max_length=1500)
    public_statement: str = Field(max_length=1500)
    confidence: int = Field(ge=0, le=100)
    trash_talk: str | None = Field(default=None, max_length=500)

    @field_validator("proposed_move")
    @classmethod
    def _uci_or_abstain(cls, v: str) -> str:
        if v == "abstain":
            return v
        if not UCI_RE.match(v):
            raise ValueError(f"not a UCI move or 'abstain': {v!r}")
        return v


class SideConfig(BaseModel):
    topology: Topology = Topology.GROUPED
    personality_preset: PersonalityPreset = PersonalityPreset.MEDIEVAL_SERIOUS
    negotiation_strategy: NegotiationStrategy = NegotiationStrategy.AUCTION
    trash_talk_intensity: TrashTalkIntensity = TrashTalkIntensity.MILD
    stockfish_mode: StockfishMode = StockfishMode.ADVISORY
    debate_rounds: int = Field(default=2, ge=1, le=5)


class Config(BaseModel):
    white: SideConfig = Field(default_factory=SideConfig)
    black: SideConfig = Field(default_factory=SideConfig)
    max_turns: int = Field(default=150, ge=1, le=500)


# --- Events (discriminated union) -------------------------------------------------


class _EventBase(BaseModel):
    seq: int = Field(ge=0)
    turn: int = Field(ge=0)


class GameCreatedEvent(_EventBase):
    type: Literal[EventType.GAME_CREATED] = EventType.GAME_CREATED
    config: Config


class TurnStartedEvent(_EventBase):
    type: Literal[EventType.TURN_STARTED] = EventType.TURN_STARTED
    side: Literal["white", "black"]
    fen: str


class ProposalEvent(_EventBase):
    type: Literal[EventType.PROPOSAL] = EventType.PROPOSAL
    side: Literal["white", "black"]
    agent: str
    proposal: Proposal


class DebateEvent(_EventBase):
    type: Literal[EventType.DEBATE] = EventType.DEBATE
    side: Literal["white", "black"]
    round: int = Field(ge=1)
    agent: str
    public_statement: str = Field(max_length=1500)
    targeting: str | None = None


class VoteEvent(_EventBase):
    type: Literal[EventType.VOTE] = EventType.VOTE
    side: Literal["white", "black"]
    agent: str
    vote: str  # UCI move being voted for


class MoveEvent(_EventBase):
    type: Literal[EventType.MOVE] = EventType.MOVE
    side: Literal["white", "black"]
    move: str  # UCI
    san: str | None = None
    fen_after: str


class ReactionEvent(_EventBase):
    type: Literal[EventType.REACTION] = EventType.REACTION
    side: Literal["white", "black"]
    agent: str
    public_statement: str = Field(max_length=1500)


class KillLineEvent(_EventBase):
    type: Literal[EventType.KILL_LINE] = EventType.KILL_LINE
    capturer: str
    captured: str
    last_words: str = Field(max_length=500)
    eulogy: str = Field(max_length=500)


class RivalryTickEvent(_EventBase):
    type: Literal[EventType.RIVALRY_TICK] = EventType.RIVALRY_TICK
    a: str
    b: str
    level: int = Field(ge=0, le=10)


class GameOverEvent(_EventBase):
    type: Literal[EventType.GAME_OVER] = EventType.GAME_OVER
    winner: Literal["white", "black", "draw"]
    reason: str


AnyEvent = Union[
    GameCreatedEvent,
    TurnStartedEvent,
    ProposalEvent,
    DebateEvent,
    VoteEvent,
    MoveEvent,
    ReactionEvent,
    KillLineEvent,
    RivalryTickEvent,
    GameOverEvent,
]


class Event(RootModel[Annotated[AnyEvent, Field(discriminator="type")]]):
    """Discriminated union wrapper. Validate unknown inputs via `Event.model_validate`."""


# --- API request / response --------------------------------------------------------


class CreateGameRequest(BaseModel):
    config: Config = Field(default_factory=Config)


class CreateGameResponse(BaseModel):
    id: str
    watch_url: str
    ingest_token: str = Field(min_length=32)
    ttl_seconds: int = Field(gt=0)
