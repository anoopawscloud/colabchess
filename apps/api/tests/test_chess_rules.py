"""Tests for the python-chess wrapper. Red until lib/chess_rules.py is implemented."""
from __future__ import annotations

import pytest

from lib.chess_rules import (
    GameStatus,
    IllegalMoveError,
    MoveResult,
    apply_move,
    legal_moves_uci,
    starting_fen,
)


STARTING = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"


class TestApplyMove:
    def test_legal_opening_move_advances_fen(self) -> None:
        result = apply_move(STARTING, "e2e4")
        assert isinstance(result, MoveResult)
        assert result.fen_after.startswith(
            "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b"
        )
        assert result.status == GameStatus.ONGOING
        assert result.san == "e4"

    def test_illegal_move_raises(self) -> None:
        with pytest.raises(IllegalMoveError):
            apply_move(STARTING, "e2e5")

    def test_malformed_uci_raises(self) -> None:
        with pytest.raises(IllegalMoveError):
            apply_move(STARTING, "zzzz")

    def test_detects_checkmate(self) -> None:
        # Fool's mate position: 1. f3 e5 2. g4 Qh4#
        fen = "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2"
        result = apply_move(fen, "d8h4")
        assert result.status == GameStatus.CHECKMATE
        assert result.winner == "black"

    def test_detects_stalemate(self) -> None:
        # Black king on a8, white queen on b6, white king on c6. Black to move has no legal moves.
        fen = "k7/8/1QK5/8/8/8/8/8 b - - 0 1"
        # There's no move that creates stalemate in this exact FEN; reach stalemate
        # by playing white's move into the position. We test from a one-before position.
        pre = "k7/8/2K5/8/1Q6/8/8/8 w - - 0 1"
        result = apply_move(pre, "b4b6")
        assert result.status == GameStatus.STALEMATE

    def test_castling_updates_fen(self) -> None:
        fen = "r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1"
        result = apply_move(fen, "e1g1")  # white kingside
        # After O-O, white king on g1, rook on f1
        assert "R4RK1" in result.fen_after

    def test_promotion_requires_piece_letter(self) -> None:
        fen = "8/P7/8/8/8/8/8/k6K w - - 0 1"
        result = apply_move(fen, "a7a8q")
        assert result.fen_after.startswith("Q7/")
        # Without promotion piece it's illegal (pawn can't occupy a8)
        with pytest.raises(IllegalMoveError):
            apply_move(fen, "a7a8")


class TestLegalMoves:
    def test_starting_position_has_20_moves(self) -> None:
        moves = legal_moves_uci(STARTING)
        assert len(moves) == 20
        assert "e2e4" in moves
        assert "g1f3" in moves

    def test_checkmate_position_has_no_moves(self) -> None:
        # After 1.f3 e5 2.g4 Qh4#
        fen = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"
        moves = legal_moves_uci(fen)
        assert moves == []


class TestStartingFen:
    def test_is_constant(self) -> None:
        assert starting_fen() == STARTING
