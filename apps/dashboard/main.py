"""Chess of Minds local analytics dashboard.

Reads straight from DynamoDB (chessminds-games table) and CloudWatch Logs
(/aws/lambda/chessminds-api). Serves a static HTML UI at /.

Run locally only. Binds to 127.0.0.1 by default.
"""
from __future__ import annotations

import decimal
import json
import os
import time
from pathlib import Path
from typing import Any

import boto3
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse


TABLE = os.environ.get("GAME_TABLE", "chessminds-games")
LOG_GROUP = os.environ.get("LOG_GROUP", "/aws/lambda/chessminds-api")
REGION = os.environ.get("AWS_REGION", "us-east-1")

# A game is "abandoned" if it never progressed past the bootstrap (<3 events —
# GAME_CREATED plus at most one proposal) and 30 min have passed since creation.
ABANDON_AGE_SECONDS = 30 * 60
ABANDON_SEQ_THRESHOLD = 3

app = FastAPI(title="Chess of Minds Analytics")

_ddb = boto3.resource("dynamodb", region_name=REGION)
_ddb_client = boto3.client("dynamodb", region_name=REGION)
_logs = boto3.client("logs", region_name=REGION)
_table = _ddb.Table(TABLE)

_STATIC_DIR = Path(__file__).parent
_INDEX = _STATIC_DIR / "index.html"


# --- cache -----------------------------------------------------------------------

_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, ttl: float, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (now, val)
    return val


# --- helpers ---------------------------------------------------------------------


def _json_default(v: object) -> object:
    if isinstance(v, decimal.Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    raise TypeError(f"not JSON-serializable: {type(v).__name__}")


def _scan_all_games() -> list[dict[str, Any]]:
    """Scan DDB for every META row. ~1 scan op per game in the worst case."""
    items: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {
        "FilterExpression": "sk = :sk",
        "ExpressionAttributeValues": {":sk": "META"},
    }
    while True:
        resp = _table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        lek = resp.get("LastEvaluatedKey")
        if not lek:
            break
        kwargs["ExclusiveStartKey"] = lek
    return items


def _events_for_game(game_id: str, limit: int = 500) -> list[dict[str, Any]]:
    resp = _table.query(
        KeyConditionExpression="pk = :pk AND sk BETWEEN :lo AND :hi",
        ExpressionAttributeValues={
            ":pk": f"GAME#{game_id}",
            ":lo": "EVENT#00000000",
            ":hi": "EVENT#99999999",
        },
        Limit=limit,
        ScanIndexForward=True,
    )
    return resp.get("Items", [])


def _current_turn(fen: str) -> str:
    try:
        parts = fen.split(" ")
        return "white" if parts[1] == "w" else "black"
    except Exception:
        return "unknown"


def _derive_status(raw_status: str, created_at: int, next_seq: int, now: int) -> str:
    if raw_status != "ongoing":
        return raw_status
    age = now - created_at
    if age > ABANDON_AGE_SECONDS and next_seq < ABANDON_SEQ_THRESHOLD:
        return "abandoned"
    return raw_status


def _normalize_game(raw: dict[str, Any]) -> dict[str, Any]:
    """Flatten DDB types + decode nested config JSON."""
    now = int(time.time())
    config: dict[str, Any] = {}
    try:
        config = json.loads(raw.get("config_json") or "{}")
    except json.JSONDecodeError:
        pass
    created_at = int(raw.get("created_at", 0))
    next_seq = int(raw.get("next_seq", 0))
    raw_status = raw.get("status", "unknown")
    derived = _derive_status(raw_status, created_at, next_seq, now)
    return {
        "game_id": raw.get("game_id"),
        "created_at": created_at,
        "expires_at": int(raw.get("expires_at", 0)),
        "status": raw_status,
        "status_derived": derived,
        "current_fen": raw.get("current_fen"),
        "next_seq": next_seq,
        "watch_url": raw.get("watch_url"),
        "current_turn": _current_turn(raw.get("current_fen") or ""),
        "ai_vs_ai": bool(config.get("ai_vs_ai", True)),
        "human_plays": config.get("human_plays"),
        "max_turns": config.get("max_turns"),
        "negotiation_strategy": (config.get("white") or {}).get("negotiation_strategy"),
        "personality_preset": (config.get("white") or {}).get("personality_preset"),
        "trash_talk_intensity": (config.get("white") or {}).get("trash_talk_intensity"),
    }


# --- routes ----------------------------------------------------------------------


@app.get("/api/stats")
def stats() -> JSONResponse:
    games = _cached("all_games", 15.0, _scan_all_games)
    normalized = [_normalize_game(g) for g in games]
    by_status: dict[str, int] = {}
    by_strategy: dict[str, int] = {}
    by_preset: dict[str, int] = {}
    for g in normalized:
        by_status[g["status_derived"]] = by_status.get(g["status_derived"], 0) + 1
        s = g.get("negotiation_strategy") or "unknown"
        by_strategy[s] = by_strategy.get(s, 0) + 1
        p = g.get("personality_preset") or "unknown"
        by_preset[p] = by_preset.get(p, 0) + 1
    body = {
        "total_games": len(normalized),
        "total_agents": len(normalized) * 12,
        "by_status": by_status,
        "by_strategy": by_strategy,
        "by_preset": by_preset,
    }
    return JSONResponse(content=json.loads(json.dumps(body, default=_json_default)))


@app.get("/api/games")
def games(limit: int = Query(default=100, ge=1, le=1000)) -> JSONResponse:
    raw = _cached("all_games", 15.0, _scan_all_games)
    normalized = [_normalize_game(g) for g in raw]
    normalized.sort(key=lambda g: g["created_at"], reverse=True)
    return JSONResponse(
        content=json.loads(json.dumps(normalized[:limit], default=_json_default))
    )


@app.get("/api/games/{game_id}/events")
def game_events(game_id: str, limit: int = Query(default=500, ge=1, le=2000)) -> JSONResponse:
    evts = _events_for_game(game_id, limit=limit)
    return JSONResponse(content=json.loads(json.dumps(evts, default=_json_default)))


@app.get("/api/logs")
def logs(
    filter_pattern: str = Query(default="", description="CloudWatch filter pattern e.g. 'game_started'"),
    limit: int = Query(default=200, ge=1, le=1000),
    since_minutes: int = Query(default=60, ge=1, le=10080),
) -> JSONResponse:
    """Query CloudWatch Logs for the Lambda log group."""
    start = int((time.time() - since_minutes * 60) * 1000)
    kwargs: dict[str, Any] = {
        "logGroupName": LOG_GROUP,
        "startTime": start,
        "limit": limit,
    }
    if filter_pattern:
        kwargs["filterPattern"] = filter_pattern
    try:
        resp = _logs.filter_log_events(**kwargs)
    except _logs.exceptions.ResourceNotFoundException:
        raise HTTPException(status_code=404, detail=f"log group {LOG_GROUP} not found")
    out = [
        {
            "timestamp": e.get("timestamp"),
            "ingestionTime": e.get("ingestionTime"),
            "logStreamName": e.get("logStreamName"),
            "message": e.get("message"),
        }
        for e in resp.get("events", [])
    ]
    return JSONResponse(content=out)


@app.get("/api/config")
def config() -> dict[str, Any]:
    return {
        "table": TABLE,
        "log_group": LOG_GROUP,
        "region": REGION,
        "abandon_age_seconds": ABANDON_AGE_SECONDS,
        "abandon_seq_threshold": ABANDON_SEQ_THRESHOLD,
    }


@app.get("/")
def root() -> FileResponse:
    return FileResponse(_INDEX, media_type="text/html")


def run() -> None:
    import uvicorn

    uvicorn.run(
        "main:app",
        host=os.environ.get("DASHBOARD_HOST", "127.0.0.1"),
        port=int(os.environ.get("DASHBOARD_PORT", "8787")),
        reload=False,
    )


if __name__ == "__main__":
    run()
