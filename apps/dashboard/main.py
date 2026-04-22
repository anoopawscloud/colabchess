"""Chess of Minds local analytics dashboard.

Reads straight from DynamoDB (chessminds-games table) and CloudWatch Logs
(/aws/lambda/chessminds-api). Serves a static HTML UI at /.

Run locally only. Binds to 127.0.0.1 by default.
"""
from __future__ import annotations

import json
import os
import time
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import boto3
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

REGION = os.environ.get("AWS_REGION", "us-east-1")
TABLE = os.environ.get("GAME_TABLE", "chessminds-games")
LOG_GROUP = os.environ.get("LOG_GROUP", "/aws/lambda/chessminds-api")

STATIC_DIR = Path(__file__).parent / "static"

app = FastAPI(title="Chess of Minds Analytics", docs_url=None, redoc_url=None)

_ddb = boto3.resource("dynamodb", region_name=REGION)
_logs = boto3.client("logs", region_name=REGION)
_table = _ddb.Table(TABLE)

# Short cache so hitting the dashboard doesn't re-scan DDB every page load.
_cache: dict[str, tuple[float, Any]] = {}
_CACHE_TTL = 30.0  # seconds


def _cached(key: str, ttl: float, fn):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < ttl:
        return hit[1]
    val = fn()
    _cache[key] = (now, val)
    return val


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


def _normalize_game(raw: dict[str, Any]) -> dict[str, Any]:
    """Flatten DDB types + decode nested config JSON."""
    try:
        config = json.loads(raw.get("config_json", "{}"))
    except (json.JSONDecodeError, TypeError):
        config = {}
    return {
        "id": raw.get("game_id"),
        "created_at": int(raw.get("created_at", 0)),
        "expires_at": int(raw.get("expires_at", 0)),
        "status": raw.get("status", "unknown"),
        "current_fen": raw.get("current_fen", ""),
        "next_seq": int(raw.get("next_seq", 0)),
        "watch_url": raw.get("watch_url"),
        "mode": config.get("mode", "ai_vs_ai"),
        "human_plays": config.get("human_plays"),
        "max_turns": config.get("max_turns"),
        "white": {
            "negotiation_strategy": (config.get("white") or {}).get("negotiation_strategy"),
            "personality_preset": (config.get("white") or {}).get("personality_preset"),
            "trash_talk_intensity": (config.get("white") or {}).get("trash_talk_intensity"),
        },
        "black": {
            "negotiation_strategy": (config.get("black") or {}).get("negotiation_strategy"),
            "personality_preset": (config.get("black") or {}).get("personality_preset"),
            "trash_talk_intensity": (config.get("black") or {}).get("trash_talk_intensity"),
        },
    }


def _current_turn(fen: str) -> int:
    parts = fen.split(" ")
    try:
        return int(parts[5]) if len(parts) >= 6 else 0
    except ValueError:
        return 0


# ─── endpoints ──────────────────────────────────────────────────────────────────


@app.get("/api/stats")
def stats() -> JSONResponse:
    def compute() -> dict[str, Any]:
        raw = _scan_all_games()
        games = [_normalize_game(r) for r in raw]
        now = int(time.time())
        day = 24 * 3600

        total = len(games)
        by_status = Counter(g["status"] for g in games)
        by_mode = Counter(g["mode"] for g in games)
        white_strat = Counter(
            g["white"]["negotiation_strategy"] for g in games if g["white"]["negotiation_strategy"]
        )
        black_strat = Counter(
            g["black"]["negotiation_strategy"] for g in games if g["black"]["negotiation_strategy"]
        )
        white_preset = Counter(
            g["white"]["personality_preset"] for g in games if g["white"]["personality_preset"]
        )
        black_preset = Counter(
            g["black"]["personality_preset"] for g in games if g["black"]["personality_preset"]
        )
        human_side = Counter(g["human_plays"] for g in games if g["human_plays"])

        last_24h = sum(1 for g in games if now - g["created_at"] < day)
        last_hour = sum(1 for g in games if now - g["created_at"] < 3600)

        turns = [_current_turn(g["current_fen"]) for g in games]
        total_events = sum(max(0, g["next_seq"]) for g in games)
        avg_turns = sum(turns) / total if total else 0.0
        avg_events = total_events / total if total else 0.0
        max_turns = max(turns) if turns else 0

        # Simple histogram buckets
        buckets = [0, 1, 3, 5, 10, 20, 40, 80]
        counts = [0] * len(buckets)
        for t in turns:
            placed = False
            for i in range(len(buckets) - 1, -1, -1):
                if t >= buckets[i]:
                    counts[i] += 1
                    placed = True
                    break
            if not placed:
                counts[0] += 1

        return {
            "total_games": total,
            "active_games": by_status.get("ongoing", 0),
            "completed_games": sum(
                c for s, c in by_status.items() if s in {"checkmate", "stalemate", "insufficient_material"}
            ),
            "other_status_games": sum(
                c
                for s, c in by_status.items()
                if s not in {"ongoing", "checkmate", "stalemate", "insufficient_material"}
            ),
            "games_last_24h": last_24h,
            "games_last_hour": last_hour,
            "total_events": total_events,
            "avg_turns_per_game": round(avg_turns, 1),
            "avg_events_per_game": round(avg_events, 1),
            "max_turn_reached": max_turns,
            "by_status": dict(by_status),
            "by_mode": dict(by_mode),
            "human_side": dict(human_side),
            "strategies": {
                "white": dict(white_strat),
                "black": dict(black_strat),
            },
            "presets": {
                "white": dict(white_preset),
                "black": dict(black_preset),
            },
            "turn_histogram": {"buckets": buckets, "counts": counts},
            "generated_at": now,
        }

    return JSONResponse(_cached("stats", _CACHE_TTL, compute))


@app.get("/api/games")
def games(limit: int = Query(50, ge=1, le=500)) -> JSONResponse:
    def compute() -> list[dict[str, Any]]:
        raw = _scan_all_games()
        games_list = [_normalize_game(r) for r in raw]
        games_list.sort(key=lambda g: g["created_at"], reverse=True)
        for g in games_list:
            g["current_turn"] = _current_turn(g["current_fen"])
        return games_list

    all_games = _cached("all_games", _CACHE_TTL, compute)
    return JSONResponse(all_games[:limit])


@app.get("/api/games/{game_id}/events")
def game_events(game_id: str, limit: int = Query(500, ge=1, le=2000)) -> JSONResponse:
    items = _events_for_game(game_id, limit=limit)
    # Strip DDB-specific keys + convert Decimals
    cleaned = []
    for item in items:
        out = {}
        for k, v in item.items():
            if k in {"pk", "sk"}:
                continue
            if hasattr(v, "to_integral_value"):
                out[k] = int(v) if v == v.to_integral_value() else float(v)
            else:
                out[k] = v
        cleaned.append(out)
    return JSONResponse(cleaned)


@app.get("/api/logs")
def logs(
    filter_pattern: str = Query("", description="CloudWatch filter pattern e.g. 'game_started'"),
    limit: int = Query(50, ge=1, le=500),
    since_minutes: int = Query(60, ge=1, le=10080),
) -> JSONResponse:
    """Query CloudWatch Logs for the Lambda log group."""
    start_ms = int((time.time() - since_minutes * 60) * 1000)
    kwargs: dict[str, Any] = {
        "logGroupName": LOG_GROUP,
        "startTime": start_ms,
        "limit": limit,
    }
    if filter_pattern:
        kwargs["filterPattern"] = filter_pattern
    try:
        resp = _logs.filter_log_events(**kwargs)
    except _logs.exceptions.ResourceNotFoundException:
        raise HTTPException(404, f"log group {LOG_GROUP} not found") from None

    events = []
    for e in resp.get("events", []):
        msg = e.get("message", "")
        # Try to parse our structured analytics lines
        parsed = None
        idx = msg.find("{")
        if idx >= 0:
            try:
                parsed = json.loads(msg[idx:])
            except json.JSONDecodeError:
                parsed = None
        events.append(
            {
                "timestamp": e.get("timestamp"),
                "ingested_ms": e.get("ingestionTime"),
                "log_stream": e.get("logStreamName"),
                "message": msg.strip(),
                "parsed": parsed,
            }
        )
    events.sort(key=lambda x: x["timestamp"] or 0, reverse=True)
    return JSONResponse(events)


@app.get("/api/config")
def config() -> JSONResponse:
    return JSONResponse(
        {
            "region": REGION,
            "table": TABLE,
            "log_group": LOG_GROUP,
        }
    )


# ─── static ────────────────────────────────────────────────────────────────────

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
def root() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


# ─── entrypoint ────────────────────────────────────────────────────────────────


def run() -> None:
    import uvicorn

    host = os.environ.get("DASHBOARD_HOST", "127.0.0.1")
    port = int(os.environ.get("DASHBOARD_PORT", "8765"))
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        log_level="info",
        reload=False,
    )


if __name__ == "__main__":
    run()
