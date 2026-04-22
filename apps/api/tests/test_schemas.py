"""Schema contract tests. Red until engine/schemas.py is implemented."""
from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from engine.schemas import (
    Config,
    CreateGameRequest,
    CreateGameResponse,
    Event,
    EventType,
    MoveEvent,
    NegotiationStrategy,
    PersonalityPreset,
    Proposal,
    ProposalEvent,
    ReactionEvent,
    SideConfig,
    Topology,
    TrashTalkIntensity,
)


class TestProposal:
    def test_valid_proposal_round_trips(self) -> None:
        p = Proposal(
            proposed_move="e2e4",
            reasoning="central pawn opens lines",
            public_statement="For king and country!",
            confidence=80,
            trash_talk=None,
        )
        dumped = p.model_dump()
        restored = Proposal.model_validate(dumped)
        assert restored == p

    def test_abstain_is_accepted(self) -> None:
        p = Proposal(
            proposed_move="abstain",
            reasoning="no view this turn",
            public_statement="I defer.",
            confidence=0,
        )
        assert p.proposed_move == "abstain"

    def test_confidence_is_clamped_to_0_100(self) -> None:
        with pytest.raises(ValidationError):
            Proposal(
                proposed_move="e2e4",
                reasoning="",
                public_statement="",
                confidence=150,
            )
        with pytest.raises(ValidationError):
            Proposal(
                proposed_move="e2e4",
                reasoning="",
                public_statement="",
                confidence=-1,
            )

    def test_uci_format_is_validated(self) -> None:
        with pytest.raises(ValidationError):
            Proposal(
                proposed_move="Nf3+",
                reasoning="",
                public_statement="",
                confidence=50,
            )
        with pytest.raises(ValidationError):
            Proposal(
                proposed_move="not a move",
                reasoning="",
                public_statement="",
                confidence=50,
            )

    def test_uci_promotion_is_allowed(self) -> None:
        p = Proposal(
            proposed_move="e7e8q",
            reasoning="promote",
            public_statement="Glorious!",
            confidence=90,
        )
        assert p.proposed_move == "e7e8q"


class TestSideConfig:
    def test_defaults(self) -> None:
        side = SideConfig()
        assert side.topology == Topology.GROUPED
        assert side.personality_preset == PersonalityPreset.MEDIEVAL_SERIOUS
        assert side.negotiation_strategy == NegotiationStrategy.AUCTION
        assert side.trash_talk_intensity == TrashTalkIntensity.MILD

    def test_rejects_unknown_preset(self) -> None:
        with pytest.raises(ValidationError):
            SideConfig(personality_preset="klingon_operatic")


class TestConfig:
    def test_defaults_populate_both_sides(self) -> None:
        cfg = Config()
        assert cfg.white.negotiation_strategy == NegotiationStrategy.AUCTION
        assert cfg.black.negotiation_strategy == NegotiationStrategy.AUCTION
        assert cfg.max_turns > 0

    def test_asymmetric_strategies_allowed(self) -> None:
        cfg = Config(
            white=SideConfig(negotiation_strategy=NegotiationStrategy.MONARCHY),
            black=SideConfig(negotiation_strategy=NegotiationStrategy.ANARCHY),
        )
        assert cfg.white.negotiation_strategy == NegotiationStrategy.MONARCHY
        assert cfg.black.negotiation_strategy == NegotiationStrategy.ANARCHY

    def test_max_turns_is_bounded(self) -> None:
        with pytest.raises(ValidationError):
            Config(max_turns=0)
        with pytest.raises(ValidationError):
            Config(max_turns=10_000)

    def test_config_serializes_to_json_stable(self) -> None:
        cfg = Config()
        blob = cfg.model_dump_json()
        restored = Config.model_validate_json(blob)
        assert restored == cfg




class TestEvents:
    def test_proposal_event_has_discriminator(self) -> None:
        e = ProposalEvent(
            seq=1,
            turn=1,
            side="white",
            agent="knights",
            proposal=Proposal(
                proposed_move="g1f3",
                reasoning="develop",
                public_statement="Onward.",
                confidence=70,
            ),
        )
        assert e.type == EventType.PROPOSAL
        # Round-trip through the discriminated union
        blob = json.loads(e.model_dump_json())
        restored = Event.model_validate(blob)
        assert restored.root == e

    def test_move_event_shape(self) -> None:
        e = MoveEvent(
            seq=2,
            turn=1,
            side="white",
            move="e2e4",
            fen_after="rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1",
        )
        assert e.type == EventType.MOVE

    def test_reaction_event_shape(self) -> None:
        e = ReactionEvent(
            seq=3,
            turn=1,
            side="black",
            agent="pawns",
            public_statement="Oh no.",
        )
        assert e.type == EventType.REACTION

    def test_unknown_event_type_rejected(self) -> None:
        with pytest.raises(ValidationError):
            Event.model_validate({"type": "NOT_A_TYPE", "seq": 1})


class TestCreateGame:
    def test_request_defaults(self) -> None:
        req = CreateGameRequest()
        assert req.config.white.negotiation_strategy == NegotiationStrategy.AUCTION

    def test_response_shape(self) -> None:
        resp = CreateGameResponse(
            id="abc123",
            watch_url="https://chessminds.vercel.app/game/abc123",
            ingest_token="x" * 43,
            ttl_seconds=7 * 24 * 3600,
        )
        assert resp.id == "abc123"
        assert resp.ttl_seconds > 0

    def test_response_rejects_short_token(self) -> None:
        with pytest.raises(ValidationError):
            CreateGameResponse(
                id="abc123",
                watch_url="https://chessminds.vercel.app/game/abc123",
                ingest_token="short",
                ttl_seconds=3600,
            )
