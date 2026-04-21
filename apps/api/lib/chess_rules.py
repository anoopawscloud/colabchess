"""Authoritative chess rules wrapper around python-chess.

Server-side this is the source of truth for legal moves and game status.
No handler should ever trust client-supplied FENs or moves without routing
through `apply_move` / `legal_moves_uci`.
"""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum

import chess


class GameStatus(str, Enum):
    ONGOING = "ongoing"
    CHECKMATE = "checkmate"
    STALEMATE = "stalemate"
    INSUFFICIENT_MATERIAL = "insufficient_material"
    SEVENTYFIVE_MOVES = "seventyfive_moves"
    FIVEFOLD_REPETITION = "fivefold_repetition"


class IllegalMoveError(ValueError):
    """Raised when a move is malformed UCI or not legal in the given position."""


@dataclass(frozen=True)
class MoveResult:
    fen_after: str
    san: str
    status: GameStatus
    winner: str | None  # "white" | "black" | None


def starting_fen() -> str:
    return chess.STARTING_FEN


def _status_for(board: chess.Board) -> tuple[GameStatus, str | None]:
    if board.is_checkmate():
        winner = "white" if board.turn == chess.BLACK else "black"
        return GameStatus.CHECKMATE, winner
    if board.is_stalemate():
        return GameStatus.STALEMATE, None
    if board.is_insufficient_material():
        return GameStatus.INSUFFICIENT_MATERIAL, None
    if board.is_seventyfive_moves():
        return GameStatus.SEVENTYFIVE_MOVES, None
    if board.is_fivefold_repetition():
        return GameStatus.FIVEFOLD_REPETITION, None
    return GameStatus.ONGOING, None


def apply_move(fen: str, uci: str) -> MoveResult:
    try:
        board = chess.Board(fen)
    except ValueError as e:
        raise IllegalMoveError(f"invalid FEN: {e}") from e

    try:
        move = chess.Move.from_uci(uci)
    except chess.InvalidMoveError as e:
        raise IllegalMoveError(f"malformed UCI {uci!r}: {e}") from e

    if move not in board.legal_moves:
        raise IllegalMoveError(f"illegal move {uci!r} in position {fen!r}")

    san = board.san(move)
    board.push(move)
    status, winner = _status_for(board)

    return MoveResult(
        fen_after=board.fen(),
        san=san,
        status=status,
        winner=winner,
    )


def legal_moves_uci(fen: str) -> list[str]:
    try:
        board = chess.Board(fen)
    except ValueError as e:
        raise IllegalMoveError(f"invalid FEN: {e}") from e
    return [m.uci() for m in board.legal_moves]
