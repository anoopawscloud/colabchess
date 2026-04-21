"""Single-table DynamoDB repo for Chess of Minds games.

Table shape (GameTable):
    pk: "GAME#{game_id}"              (HASH)
    sk: "META" | "EVENT#{seq:08d}"    (RANGE)
    expires_at: int (Unix epoch)      TTL attribute

The META row owns a `next_seq` counter that `put_event` increments atomically
(DynamoDB UpdateItem with ADD) before writing the event row. Single-writer-per-game
is enforced externally by the ingest_token, so there is no contention to worry about
in practice; the atomic counter is defensive.

Ingest tokens are stored as SHA-256 hashes. `verify_token` performs a constant-time
comparison so a leaked DDB read doesn't directly leak raw tokens.
"""
from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import ClientError


class GameNotFoundError(Exception):
    pass


class IngestTokenMismatchError(Exception):
    pass


@dataclass(frozen=True)
class GameRow:
    game_id: str
    config_json: str
    watch_url: str
    current_fen: str
    status: str
    next_seq: int
    expires_at: int
    created_at: int


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _pk(game_id: str) -> str:
    return f"GAME#{game_id}"


def _event_sk(seq: int) -> str:
    return f"EVENT#{seq:08d}"


def create_table(name: str, region: str) -> None:
    """Create the single-table GameTable. Test / bootstrap helper only.

    In production CDK provisions this.
    """
    client = boto3.client("dynamodb", region_name=region)
    try:
        client.describe_table(TableName=name)
        return
    except client.exceptions.ResourceNotFoundException:
        pass
    client.create_table(
        TableName=name,
        AttributeDefinitions=[
            {"AttributeName": "pk", "AttributeType": "S"},
            {"AttributeName": "sk", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "pk", "KeyType": "HASH"},
            {"AttributeName": "sk", "KeyType": "RANGE"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    client.get_waiter("table_exists").wait(TableName=name)
    client.update_time_to_live(
        TableName=name,
        TimeToLiveSpecification={"Enabled": True, "AttributeName": "expires_at"},
    )


class GameRepo:
    def __init__(self, table_name: str, region: str = "us-east-1") -> None:
        self._table_name = table_name
        self._resource = boto3.resource("dynamodb", region_name=region)
        self._table = self._resource.Table(table_name)

    # --- game metadata -----------------------------------------------------------

    def put_game(
        self,
        *,
        game_id: str,
        config_json: str,
        watch_url: str,
        ingest_token: str,
        starting_fen: str,
        ttl_seconds: int,
    ) -> None:
        now = int(time.time())
        try:
            self._table.put_item(
                Item={
                    "pk": _pk(game_id),
                    "sk": "META",
                    "game_id": game_id,
                    "config_json": config_json,
                    "watch_url": watch_url,
                    "token_hash": _hash_token(ingest_token),
                    "current_fen": starting_fen,
                    "status": "ongoing",
                    "next_seq": 0,
                    "created_at": now,
                    "expires_at": now + ttl_seconds,
                },
                ConditionExpression="attribute_not_exists(pk)",
            )
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise ValueError(f"game {game_id!r} already exists") from e
            raise

    def get_game(self, game_id: str) -> GameRow | None:
        resp = self._table.get_item(Key={"pk": _pk(game_id), "sk": "META"})
        item = resp.get("Item")
        if item is None:
            return None
        return GameRow(
            game_id=item["game_id"],
            config_json=item["config_json"],
            watch_url=item["watch_url"],
            current_fen=item["current_fen"],
            status=item["status"],
            next_seq=int(item["next_seq"]),
            expires_at=int(item["expires_at"]),
            created_at=int(item["created_at"]),
        )

    def verify_token(self, game_id: str, ingest_token: str) -> None:
        resp = self._table.get_item(
            Key={"pk": _pk(game_id), "sk": "META"},
            ProjectionExpression="token_hash",
        )
        item = resp.get("Item")
        if item is None:
            raise GameNotFoundError(game_id)
        if not hmac.compare_digest(item["token_hash"], _hash_token(ingest_token)):
            raise IngestTokenMismatchError(game_id)

    # --- events ------------------------------------------------------------------

    def put_event(self, game_id: str, event: dict[str, Any]) -> int:
        try:
            resp = self._table.update_item(
                Key={"pk": _pk(game_id), "sk": "META"},
                UpdateExpression="ADD next_seq :one",
                ConditionExpression="attribute_exists(pk)",
                ExpressionAttributeValues={":one": 1},
                ReturnValues="UPDATED_NEW",
            )
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise GameNotFoundError(game_id) from e
            raise

        seq = int(resp["Attributes"]["next_seq"])
        meta = self.get_game(game_id)
        assert meta is not None  # we just incremented its counter
        item = {
            "pk": _pk(game_id),
            "sk": _event_sk(seq),
            "seq": seq,
            "expires_at": meta.expires_at,
            **event,
        }
        self._table.put_item(Item=item)
        return seq

    def list_events(
        self, game_id: str, since: int = 0, limit: int = 500
    ) -> list[dict[str, Any]]:
        resp = self._table.query(
            KeyConditionExpression="pk = :pk AND sk BETWEEN :lo AND :hi",
            ExpressionAttributeValues={
                ":pk": _pk(game_id),
                ":lo": _event_sk(since + 1),
                ":hi": "EVENT#99999999",
            },
            Limit=limit,
            ScanIndexForward=True,
        )
        return [self._strip_table_keys(item) for item in resp.get("Items", [])]

    @staticmethod
    def _strip_table_keys(item: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in item.items() if k not in {"pk", "sk"}}
        if "seq" in out:
            out["seq"] = int(out["seq"])
        return out

    # --- state updates -----------------------------------------------------------

    def update_state(self, game_id: str, *, current_fen: str, status: str) -> None:
        try:
            self._table.update_item(
                Key={"pk": _pk(game_id), "sk": "META"},
                UpdateExpression="SET current_fen = :f, #s = :st",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":f": current_fen, ":st": status},
                ConditionExpression="attribute_exists(pk)",
            )
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                raise GameNotFoundError(game_id) from e
            raise
