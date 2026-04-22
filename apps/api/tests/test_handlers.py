"""End-to-end handler tests. Invoke the Lambda handler with synthetic API Gateway
HTTP API v2 events and assert on the response shape."""
from __future__ import annotations

import json
import os
from collections.abc import Iterator
from typing import Any

import pytest
from moto import mock_aws

from lib.db import create_table


TABLE = "chessminds-games-test"
REGION = "us-east-1"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    monkeypatch.setenv("AWS_DEFAULT_REGION", REGION)
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("GAME_TABLE", TABLE)
    monkeypatch.setenv("WATCH_URL_BASE", "https://chessminds.test/game")
    monkeypatch.setenv("GAME_TTL_SECONDS", "604800")
    yield


@pytest.fixture
def ddb() -> Iterator[None]:
    with mock_aws():
        create_table(TABLE, region=REGION)
        yield


def _event(
    method: str,
    path: str,
    *,
    body: Any = None,
    headers: dict[str, str] | None = None,
    path_parameters: dict[str, str] | None = None,
) -> dict[str, Any]:
    headers = {k.lower(): v for k, v in (headers or {}).items()}
    headers.setdefault("content-type", "application/json")
    if "?" in path:
        path_only, raw_query = path.split("?", 1)
    else:
        path_only, raw_query = path, ""
    return {
        "version": "2.0",
        "routeKey": f"{method} {path_only}",
        "rawPath": path_only,
        "rawQueryString": raw_query,
        "queryStringParameters": dict(
            tuple(p.split("=", 1)) for p in raw_query.split("&") if "=" in p
        ) or None,
        "headers": headers,
        "requestContext": {
            "accountId": "123456789012",
            "apiId": "test",
            "domainName": "test.execute-api.local",
            "domainPrefix": "test",
            "http": {
                "method": method,
                "path": path_only,
                "protocol": "HTTP/1.1",
                "sourceIp": "127.0.0.1",
                "userAgent": "pytest",
            },
            "requestId": "req-test",
            "routeKey": f"{method} {path_only}",
            "stage": "$default",
            "time": "21/Apr/2026:00:00:00 +0000",
            "timeEpoch": 1776806400000,
        },
        "body": json.dumps(body) if body is not None else None,
        "isBase64Encoded": False,
        "pathParameters": path_parameters,
    }


def _invoke(event: dict[str, Any]) -> dict[str, Any]:
    from handlers.api import handler

    resp = handler(event, None)
    body = resp.get("body")
    if isinstance(body, str):
        try:
            resp["_json"] = json.loads(body)
        except json.JSONDecodeError:
            pass
    return resp


class TestCreateGame:
    def test_defaults(self, ddb: None) -> None:
        resp = _invoke(_event("POST", "/games", body={}))
        assert resp["statusCode"] == 201, resp
        body = resp["_json"]
        assert len(body["id"]) >= 8
        assert body["watch_url"] == f"https://chessminds.test/game/{body['id']}"
        assert len(body["ingest_token"]) >= 32
        assert body["ttl_seconds"] == 604800

    def test_custom_config(self, ddb: None) -> None:
        resp = _invoke(
            _event(
                "POST",
                "/games",
                body={"config": {"max_turns": 40}},
            )
        )
        assert resp["statusCode"] == 201, resp
        body = resp["_json"]
        assert body["id"]
        # GET snapshot and confirm config round-tripped
        snap = _invoke(_event("GET", f"/games/{body['id']}", path_parameters={"id": body["id"]}))
        assert snap["statusCode"] == 200, snap
        assert snap["_json"]["config"]["max_turns"] == 40

    def test_rejects_invalid_config(self, ddb: None) -> None:
        resp = _invoke(
            _event(
                "POST",
                "/games",
                body={"config": {"max_turns": 9999}},
            )
        )
        assert resp["statusCode"] == 400, resp


class TestHumanToken:
    def test_ai_vs_ai_has_no_play_url(self, ddb: None) -> None:
        body = _invoke(_event("POST", "/games", body={}))["_json"]
        assert body.get("play_url") is None
        assert body.get("human_token") is None

    def test_human_vs_ai_returns_play_url_and_token(self, ddb: None) -> None:
        body = _invoke(
            _event(
                "POST",
                "/games",
                body={"config": {"mode": "human_vs_ai", "human_plays": "white"}},
            )
        )["_json"]
        assert isinstance(body["play_url"], str)
        assert body["play_url"].endswith(f"?play={body['human_token']}")
        assert len(body["human_token"]) >= 32
        assert body["ingest_token"] != body["human_token"]

    def test_human_token_can_play_its_side(self, ddb: None) -> None:
        created = _invoke(
            _event(
                "POST",
                "/games",
                body={"config": {"mode": "human_vs_ai", "human_plays": "white"}},
            )
        )["_json"]
        resp = _invoke(
            _event(
                "POST",
                f"/games/{created['id']}/move",
                body={"move": "e2e4", "side": "white", "turn": 1},
                headers={"authorization": f"Bearer {created['human_token']}"},
                path_parameters={"id": created["id"]},
            )
        )
        assert resp["statusCode"] == 200, resp

    def test_human_token_rejects_opponent_side(self, ddb: None) -> None:
        created = _invoke(
            _event(
                "POST",
                "/games",
                body={"config": {"mode": "human_vs_ai", "human_plays": "white"}},
            )
        )["_json"]
        resp = _invoke(
            _event(
                "POST",
                f"/games/{created['id']}/move",
                body={"move": "e7e5", "side": "black", "turn": 1},
                headers={"authorization": f"Bearer {created['human_token']}"},
                path_parameters={"id": created["id"]},
            )
        )
        assert resp["statusCode"] == 401, resp

    def test_ingest_token_still_works_in_1p_games(self, ddb: None) -> None:
        created = _invoke(
            _event(
                "POST",
                "/games",
                body={"config": {"mode": "human_vs_ai", "human_plays": "black"}},
            )
        )["_json"]
        resp = _invoke(
            _event(
                "POST",
                f"/games/{created['id']}/move",
                body={"move": "e2e4", "side": "white", "turn": 1},
                headers={"authorization": f"Bearer {created['ingest_token']}"},
                path_parameters={"id": created["id"]},
            )
        )
        assert resp["statusCode"] == 200, resp


class TestModeField:
    def test_default_mode_is_ai_vs_ai(self, ddb: None) -> None:
        created = _invoke(_event("POST", "/games", body={}))["_json"]
        gid = created["id"]
        snap = _invoke(_event("GET", f"/games/{gid}", path_parameters={"id": gid}))
        body = snap["_json"]
        assert body["mode"] == "ai_vs_ai"
        assert body["human_plays"] is None

    def test_human_vs_ai_config_round_trips(self, ddb: None) -> None:
        created = _invoke(
            _event(
                "POST",
                "/games",
                body={"config": {"mode": "human_vs_ai", "human_plays": "white"}},
            )
        )
        assert created["statusCode"] == 201, created
        gid = created["_json"]["id"]
        snap = _invoke(_event("GET", f"/games/{gid}", path_parameters={"id": gid}))
        body = snap["_json"]
        assert body["mode"] == "human_vs_ai"
        assert body["human_plays"] == "white"

    def test_human_vs_ai_without_human_plays_rejected(self, ddb: None) -> None:
        resp = _invoke(
            _event("POST", "/games", body={"config": {"mode": "human_vs_ai"}})
        )
        assert resp["statusCode"] == 400, resp


class TestSnapshot:
    def test_missing_game_returns_404(self, ddb: None) -> None:
        resp = _invoke(
            _event("GET", "/games/not-a-real-id", path_parameters={"id": "not-a-real-id"})
        )
        assert resp["statusCode"] == 404, resp

    def test_snapshot_contains_fen_and_events(self, ddb: None) -> None:
        created = _invoke(_event("POST", "/games", body={}))["_json"]
        gid = created["id"]
        token = created["ingest_token"]

        # Append an event so snapshot has something to show
        _invoke(
            _event(
                "POST",
                f"/games/{gid}/events",
                body={
                    "type": "PROPOSAL",
                    "turn": 1,
                    "side": "white",
                    "agent": "knights",
                    "proposal": {
                        "proposed_move": "e2e4",
                        "reasoning": "develop",
                        "public_statement": "For glory!",
                        "confidence": 80,
                    },
                },
                headers={"authorization": f"Bearer {token}"},
                path_parameters={"id": gid},
            )
        )

        snap = _invoke(_event("GET", f"/games/{gid}", path_parameters={"id": gid}))
        assert snap["statusCode"] == 200, snap
        body = snap["_json"]
        assert body["id"] == gid
        assert body["fen"].startswith("rnbqkbnr")
        assert body["status"] == "ongoing"
        assert body["side_to_move"] == "white"
        assert isinstance(body["legal_moves"], list)
        assert "e2e4" in body["legal_moves"]
        assert len(body["legal_moves"]) == 20
        types = [e["type"] for e in body["events"]]
        assert types == ["GAME_CREATED", "PROPOSAL"]


class TestEventsPoll:
    def test_since_cursor_returns_only_new_events(self, ddb: None) -> None:
        created = _invoke(_event("POST", "/games", body={}))["_json"]
        gid = created["id"]
        tok = created["ingest_token"]

        for i in range(3):
            _invoke(
                _event(
                    "POST",
                    f"/games/{gid}/events",
                    body={
                        "type": "PROPOSAL",
                        "turn": 1,
                        "side": "white",
                        "agent": f"a{i}",
                        "proposal": {
                            "proposed_move": "e2e4",
                            "reasoning": "",
                            "public_statement": f"p{i}",
                            "confidence": 50,
                        },
                    },
                    headers={"authorization": f"Bearer {tok}"},
                    path_parameters={"id": gid},
                )
            )

        # First poll (since=0) should return GAME_CREATED + 3 PROPOSALS = 4 events
        first = _invoke(
            _event(
                "GET",
                f"/games/{gid}/events",
                path_parameters={"id": gid},
            )
        )
        assert first["statusCode"] == 200, first
        assert len(first["_json"]["events"]) == 4
        assert first["_json"]["next_seq"] == 4

        # Poll again with since=4 should return nothing new
        empty = _invoke(
            _event(
                "GET",
                f"/games/{gid}/events?since=4",
                path_parameters={"id": gid},
            )
        )
        assert empty["statusCode"] == 200, empty
        assert empty["_json"]["events"] == []
        assert empty["_json"]["next_seq"] == 4

    def test_missing_game_returns_404(self, ddb: None) -> None:
        resp = _invoke(
            _event("GET", "/games/nope/events", path_parameters={"id": "nope"})
        )
        assert resp["statusCode"] == 404, resp


class TestAppendEvent:
    def test_requires_auth(self, ddb: None) -> None:
        created = _invoke(_event("POST", "/games", body={}))["_json"]
        resp = _invoke(
            _event(
                "POST",
                f"/games/{created['id']}/events",
                body={"type": "PROPOSAL", "turn": 1},
                path_parameters={"id": created["id"]},
            )
        )
        assert resp["statusCode"] == 401, resp

    def test_wrong_token_rejected(self, ddb: None) -> None:
        created = _invoke(_event("POST", "/games", body={}))["_json"]
        resp = _invoke(
            _event(
                "POST",
                f"/games/{created['id']}/events",
                body={"type": "PROPOSAL", "turn": 1, "side": "white", "agent": "x",
                      "proposal": {"proposed_move": "e2e4", "reasoning": "",
                                   "public_statement": "", "confidence": 50}},
                headers={"authorization": "Bearer not-the-right-token"},
                path_parameters={"id": created["id"]},
            )
        )
        assert resp["statusCode"] == 401, resp

    def test_correct_token_assigns_seq(self, ddb: None) -> None:
        created = _invoke(_event("POST", "/games", body={}))["_json"]
        r1 = _invoke(
            _event(
                "POST",
                f"/games/{created['id']}/events",
                body={"type": "PROPOSAL", "turn": 1, "side": "white", "agent": "x",
                      "proposal": {"proposed_move": "e2e4", "reasoning": "",
                                   "public_statement": "", "confidence": 50}},
                headers={"authorization": f"Bearer {created['ingest_token']}"},
                path_parameters={"id": created["id"]},
            )
        )
        assert r1["statusCode"] == 201, r1
        # create_game itself writes a GAME_CREATED event at seq=1, so the first
        # client-written event lands at seq=2.
        assert r1["_json"]["seq"] == 2


class TestPlayMove:
    def _create(self) -> tuple[str, str]:
        created = _invoke(_event("POST", "/games", body={}))["_json"]
        return created["id"], created["ingest_token"]

    def test_legal_move_advances_fen(self, ddb: None) -> None:
        gid, tok = self._create()
        resp = _invoke(
            _event(
                "POST",
                f"/games/{gid}/move",
                body={"move": "e2e4", "side": "white", "turn": 1},
                headers={"authorization": f"Bearer {tok}"},
                path_parameters={"id": gid},
            )
        )
        assert resp["statusCode"] == 200, resp
        body = resp["_json"]
        assert body["fen_after"].startswith("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b")
        assert body["san"] == "e4"
        assert body["status"] == "ongoing"
        assert isinstance(body["legal_moves"], list)

    def test_illegal_move_400(self, ddb: None) -> None:
        gid, tok = self._create()
        resp = _invoke(
            _event(
                "POST",
                f"/games/{gid}/move",
                body={"move": "e2e5", "side": "white", "turn": 1},
                headers={"authorization": f"Bearer {tok}"},
                path_parameters={"id": gid},
            )
        )
        assert resp["statusCode"] == 400, resp

    def test_move_without_auth_401(self, ddb: None) -> None:
        gid, _ = self._create()
        resp = _invoke(
            _event(
                "POST",
                f"/games/{gid}/move",
                body={"move": "e2e4", "side": "white", "turn": 1},
                path_parameters={"id": gid},
            )
        )
        assert resp["statusCode"] == 401, resp

    def test_move_writes_move_event(self, ddb: None) -> None:
        gid, tok = self._create()
        _invoke(
            _event(
                "POST",
                f"/games/{gid}/move",
                body={"move": "e2e4", "side": "white", "turn": 1},
                headers={"authorization": f"Bearer {tok}"},
                path_parameters={"id": gid},
            )
        )
        snap = _invoke(_event("GET", f"/games/{gid}", path_parameters={"id": gid}))
        events = snap["_json"]["events"]
        assert any(e["type"] == "MOVE" and e.get("move") == "e2e4" for e in events)
