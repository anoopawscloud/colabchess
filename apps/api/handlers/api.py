"""Single Lambda entrypoint for Chess of Minds REST API.

Routes:
    POST /games                    — create a new game session
    GET  /games/{id}               — snapshot (FEN, last events, status)
    POST /games/{id}/events        — append arbitrary event (auth'd)
    POST /games/{id}/move          — server-validated move play (auth'd)

Auth: `Authorization: Bearer {ingest_token}` on write endpoints. Anyone may view.
"""
from __future__ import annotations

import json
import os
import secrets

from aws_lambda_powertools.event_handler import APIGatewayHttpResolver, Response
from aws_lambda_powertools.event_handler.exceptions import (
    BadRequestError,
    NotFoundError,
    UnauthorizedError,
)
from pydantic import ValidationError

from engine.schemas import Config, CreateGameRequest, CreateGameResponse
from lib.chess_rules import (
    GameStatus,
    IllegalMoveError,
    apply_move,
    legal_moves_uci,
    starting_fen,
)
from lib.db import (
    GameNotFoundError,
    GameRepo,
    IngestTokenMismatchError,
)


app = APIGatewayHttpResolver()


# --- config from env ---------------------------------------------------------------


def _repo() -> GameRepo:
    return GameRepo(
        table_name=os.environ["GAME_TABLE"],
        region=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION", "us-east-1"),
    )


def _watch_url(game_id: str) -> str:
    base = os.environ.get("WATCH_URL_BASE", "https://chessminds-psi.vercel.app/game")
    return f"{base}/{game_id}"


def _ttl_seconds() -> int:
    return int(os.environ.get("GAME_TTL_SECONDS", "604800"))


# --- helpers ----------------------------------------------------------------------


def _require_bearer(repo: GameRepo, game_id: str) -> None:
    headers = {k.lower(): v for k, v in (app.current_event.headers or {}).items()}
    auth = headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise UnauthorizedError("missing bearer token")
    token = auth.split(" ", 1)[1].strip()
    try:
        repo.verify_token(game_id, token)
    except GameNotFoundError as e:
        raise NotFoundError(f"game {game_id!r} not found") from e
    except IngestTokenMismatchError as e:
        raise UnauthorizedError("token does not match game") from e


def _json_body() -> dict:
    body = app.current_event.json_body
    return body if isinstance(body, dict) else {}


# --- routes -----------------------------------------------------------------------


@app.post("/games")
def create_game() -> Response:
    try:
        req = CreateGameRequest.model_validate(_json_body())
    except ValidationError as e:
        raise BadRequestError(f"invalid config: {e.errors(include_url=False)}") from e

    game_id = secrets.token_urlsafe(6)
    ingest_token = secrets.token_urlsafe(32)
    watch = _watch_url(game_id)
    ttl = _ttl_seconds()

    repo = _repo()
    repo.put_game(
        game_id=game_id,
        config_json=req.config.model_dump_json(),
        watch_url=watch,
        ingest_token=ingest_token,
        starting_fen=starting_fen(),
        ttl_seconds=ttl,
    )
    # Record a GAME_CREATED event so the stream has a head to tail from.
    repo.put_event(
        game_id,
        {
            "type": "GAME_CREATED",
            "turn": 0,
            "config": json.loads(req.config.model_dump_json()),
        },
    )

    body = CreateGameResponse(
        id=game_id,
        watch_url=watch,
        ingest_token=ingest_token,
        ttl_seconds=ttl,
    ).model_dump()
    return Response(
        status_code=201,
        content_type="application/json",
        body=json.dumps(body),
    )


@app.get("/games/<game_id>")
def snapshot(game_id: str) -> Response:
    repo = _repo()
    game = repo.get_game(game_id)
    if game is None:
        raise NotFoundError(f"game {game_id!r} not found")

    events = repo.list_events(game_id, since=0, limit=500)
    legal_moves = (
        legal_moves_uci(game.current_fen) if game.status == "ongoing" else []
    )
    side_to_move = game.current_fen.split(" ")[1] if " " in game.current_fen else "w"
    config = json.loads(game.config_json)
    body = {
        "id": game.game_id,
        "fen": game.current_fen,
        "status": game.status,
        "side_to_move": "white" if side_to_move == "w" else "black",
        "legal_moves": legal_moves,
        "config": config,
        "mode": config.get("mode", "ai_vs_ai"),
        "human_plays": config.get("human_plays"),
        "next_seq": game.next_seq,
        "events": events,
    }
    return Response(
        status_code=200,
        content_type="application/json",
        body=json.dumps(body, default=_json_default),
    )


@app.get("/games/<game_id>/events")
def poll_events(game_id: str) -> Response:
    repo = _repo()
    game = repo.get_game(game_id)
    if game is None:
        raise NotFoundError(f"game {game_id!r} not found")
    since = int(app.current_event.get_query_string_value("since", default_value="0") or 0)
    events = repo.list_events(game_id, since=since, limit=500)
    return Response(
        status_code=200,
        content_type="application/json",
        body=json.dumps(
            {"events": events, "next_seq": game.next_seq, "status": game.status},
            default=_json_default,
        ),
    )


@app.post("/games/<game_id>/events")
def append_event(game_id: str) -> Response:
    repo = _repo()
    _require_bearer(repo, game_id)

    body = _json_body()
    if "type" not in body:
        raise BadRequestError("event 'type' is required")

    seq = repo.put_event(game_id, body)
    return Response(
        status_code=201,
        content_type="application/json",
        body=json.dumps({"seq": seq}),
    )


@app.post("/games/<game_id>/move")
def play_move(game_id: str) -> Response:
    repo = _repo()
    _require_bearer(repo, game_id)

    body = _json_body()
    move = body.get("move")
    side = body.get("side")
    turn = body.get("turn", 0)
    if not move or side not in {"white", "black"}:
        raise BadRequestError("body must include 'move' (UCI) and 'side' ('white'|'black')")

    game = repo.get_game(game_id)
    if game is None:
        raise NotFoundError(f"game {game_id!r} not found")
    if game.status != "ongoing":
        raise BadRequestError(f"game already ended with status={game.status}")

    try:
        result = apply_move(game.current_fen, move)
    except IllegalMoveError as e:
        raise BadRequestError(str(e)) from e

    new_status = "ongoing" if result.status == GameStatus.ONGOING else result.status.value
    repo.update_state(game_id, current_fen=result.fen_after, status=new_status)
    repo.put_event(
        game_id,
        {
            "type": "MOVE",
            "turn": turn,
            "side": side,
            "move": move,
            "san": result.san,
            "fen_after": result.fen_after,
        },
    )

    legal = legal_moves_uci(result.fen_after)
    return Response(
        status_code=200,
        content_type="application/json",
        body=json.dumps(
            {
                "fen_after": result.fen_after,
                "san": result.san,
                "status": new_status,
                "winner": result.winner,
                "legal_moves": legal,
            }
        ),
    )


# --- JSON default for DynamoDB Decimal etc. ---------------------------------------


def _json_default(value: object) -> object:
    import decimal

    if isinstance(value, decimal.Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"not JSON-serializable: {type(value).__name__}")


# --- Lambda entrypoint ------------------------------------------------------------


def handler(event: dict, context: object) -> dict:
    return app.resolve(event, context)
