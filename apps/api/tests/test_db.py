"""DynamoDB single-table repo tests. Red until lib/db.py is implemented."""
from __future__ import annotations

import os
import time

import boto3
import pytest
from moto import mock_aws

from lib.db import (
    GameNotFoundError,
    GameRepo,
    IngestTokenMismatchError,
    create_table,
)


TABLE = "chessminds-games-test"
REGION = "us-east-1"


@pytest.fixture(autouse=True)
def _env() -> None:
    os.environ.setdefault("AWS_DEFAULT_REGION", REGION)
    os.environ.setdefault("AWS_ACCESS_KEY_ID", "testing")
    os.environ.setdefault("AWS_SECRET_ACCESS_KEY", "testing")
    os.environ.setdefault("AWS_SESSION_TOKEN", "testing")


@pytest.fixture
def repo():
    with mock_aws():
        create_table(TABLE, region=REGION)
        yield GameRepo(table_name=TABLE, region=REGION)


class TestPutAndGetGame:
    def test_put_and_get_round_trips(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="abc123",
            config_json='{"max_turns": 150}',
            watch_url="https://example.test/game/abc123",
            ingest_token="t" * 43,
            starting_fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
            ttl_seconds=7 * 24 * 3600,
        )
        got = repo.get_game("abc123")
        assert got is not None
        assert got.config_json == '{"max_turns": 150}'
        assert got.watch_url == "https://example.test/game/abc123"
        assert got.current_fen.startswith("rnbqkbnr")
        assert got.status == "ongoing"
        assert got.next_seq == 0
        assert got.expires_at > int(time.time())

    def test_get_missing_game_returns_none(self, repo: GameRepo) -> None:
        assert repo.get_game("nope") is None

    def test_double_create_rejected(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="abc",
            config_json="{}",
            watch_url="u",
            ingest_token="t" * 43,
            starting_fen="startfen",
            ttl_seconds=100,
        )
        with pytest.raises(ValueError):
            repo.put_game(
                game_id="abc",
                config_json="{}",
                watch_url="u",
                ingest_token="t" * 43,
                starting_fen="startfen",
                ttl_seconds=100,
            )


class TestTokenAuth:
    def test_verify_token_accepts_correct_token(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="g1",
            config_json="{}",
            watch_url="u",
            ingest_token="correct-token-12345678901234567890",
            starting_fen="f",
            ttl_seconds=100,
        )
        # Does not raise
        repo.verify_token("g1", "correct-token-12345678901234567890")

    def test_verify_token_rejects_wrong_token(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="g1",
            config_json="{}",
            watch_url="u",
            ingest_token="correct-token-12345678901234567890",
            starting_fen="f",
            ttl_seconds=100,
        )
        with pytest.raises(IngestTokenMismatchError):
            repo.verify_token("g1", "wrong-token-aaaaaaaaaaaaaaaaaaaaaaaa")

    def test_verify_token_missing_game_raises(self, repo: GameRepo) -> None:
        with pytest.raises(GameNotFoundError):
            repo.verify_token("missing", "whatever")


class TestEvents:
    def test_put_event_assigns_monotonic_seq(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="g1",
            config_json="{}",
            watch_url="u",
            ingest_token="t" * 43,
            starting_fen="f",
            ttl_seconds=100,
        )
        s1 = repo.put_event("g1", {"type": "PROPOSAL", "turn": 1, "body": "a"})
        s2 = repo.put_event("g1", {"type": "PROPOSAL", "turn": 1, "body": "b"})
        s3 = repo.put_event("g1", {"type": "MOVE", "turn": 1, "body": "c"})
        assert (s1, s2, s3) == (1, 2, 3)

        got = repo.get_game("g1")
        assert got is not None
        assert got.next_seq == 3

    def test_list_events_since(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="g1",
            config_json="{}",
            watch_url="u",
            ingest_token="t" * 43,
            starting_fen="f",
            ttl_seconds=100,
        )
        for i in range(5):
            repo.put_event("g1", {"type": "PROPOSAL", "turn": 1, "body": f"p{i}"})

        all_events = repo.list_events("g1", since=0)
        assert len(all_events) == 5
        assert [e["seq"] for e in all_events] == [1, 2, 3, 4, 5]

        tail = repo.list_events("g1", since=3)
        assert [e["seq"] for e in tail] == [4, 5]

        assert repo.list_events("g1", since=99) == []

    def test_list_events_respects_limit(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="g1",
            config_json="{}",
            watch_url="u",
            ingest_token="t" * 43,
            starting_fen="f",
            ttl_seconds=100,
        )
        for i in range(10):
            repo.put_event("g1", {"type": "PROPOSAL", "turn": 1, "body": f"p{i}"})

        page = repo.list_events("g1", since=0, limit=3)
        assert [e["seq"] for e in page] == [1, 2, 3]

    def test_put_event_on_missing_game_raises(self, repo: GameRepo) -> None:
        with pytest.raises(GameNotFoundError):
            repo.put_event("nope", {"type": "PROPOSAL"})


class TestUpdateFen:
    def test_update_fen_and_status(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="g1",
            config_json="{}",
            watch_url="u",
            ingest_token="t" * 43,
            starting_fen="start",
            ttl_seconds=100,
        )
        repo.update_state("g1", current_fen="new-fen", status="checkmate")
        got = repo.get_game("g1")
        assert got is not None
        assert got.current_fen == "new-fen"
        assert got.status == "checkmate"

    def test_update_state_missing_game_raises(self, repo: GameRepo) -> None:
        with pytest.raises(GameNotFoundError):
            repo.update_state("nope", current_fen="x", status="ongoing")


class TestTTL:
    def test_ttl_set_on_rows(self, repo: GameRepo) -> None:
        repo.put_game(
            game_id="g1",
            config_json="{}",
            watch_url="u",
            ingest_token="t" * 43,
            starting_fen="f",
            ttl_seconds=100,
        )
        repo.put_event("g1", {"type": "PROPOSAL", "turn": 1, "body": "a"})

        # Read raw table to confirm TTL attribute is present
        table = boto3.resource("dynamodb", region_name=REGION).Table(TABLE)
        meta = table.get_item(Key={"pk": "GAME#g1", "sk": "META"})["Item"]
        evt = table.get_item(Key={"pk": "GAME#g1", "sk": "EVENT#00000001"})["Item"]
        assert "expires_at" in meta
        assert "expires_at" in evt
        assert meta["expires_at"] == evt["expires_at"] or meta["expires_at"] > int(time.time())
