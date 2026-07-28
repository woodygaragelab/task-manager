"""
task_repository
================
DynamoDB(Tasks / TaskClients / TaskSeries / TaskFrames)に対するCRUDロジックの共通モジュール。

task-mcp-server(FastMCP)と task-api(Web API用Lambda)の両方から
Lambda Layer として import される。ロジックの二重実装を避けるため、
MCPツールのデコレータや Web API のルーティングには一切依存しない
プレーンな関数のみをここに置く。

タスクは Client x Series x Frame の組み合わせを最小単位として持つ
(例: 「クライアントAの資料受領・2026年6月分」)。Series/Frameはクライアント
横断の共通マスタで、タスク作成時に未登録なら自動登録される。Clientのみ、
ドロップダウンからの明示的な新規登録操作があるため create_client を持つ。
"""

import os
from datetime import datetime, timezone
from typing import Optional

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
tasks_table = dynamodb.Table(os.environ["TASKS_TABLE"])
clients_table = dynamodb.Table(os.environ["CLIENTS_TABLE"])
series_table = dynamodb.Table(os.environ["SERIES_TABLE"])
frames_table = dynamodb.Table(os.environ["FRAMES_TABLE"])

CLIENT_BUCKET = "CLIENT"
SERIES_BUCKET = "SERIES"
FRAME_BUCKET = "FRAME"


class TaskNotFoundError(Exception):
    """指定されたタスク(clientCode+seriesCode+frameCode)が存在しない場合に送出する。"""


class ClientAlreadyExistsError(Exception):
    """create_clientで既に登録済みのclientCodeを指定した場合に送出する。"""


# ----------------------------------------------------------------------
# 内部ヘルパー
# ----------------------------------------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _task_key(series_code: str, frame_code: str) -> str:
    # SortKeyをこの連結文字列にすることで、GSIなしで「シリーズ内でフレーム順」の
    # 並びが手に入る(frameCodeがYYYYMM形式のため同一シリーズ内は時系列順)。
    return f"{series_code}#{frame_code}"


def _ensure_series_exists(series_code: str, series_name: str, task_group: str = "") -> None:
    """シリーズマスタに未登録ならPutする(冪等・競合安全)。"""
    try:
        series_table.put_item(
            Item={
                "lookupBucket": SERIES_BUCKET,
                "seriesCode": series_code,
                "seriesName": series_name,
                "taskGroup": task_group,
            },
            ConditionExpression="attribute_not_exists(seriesCode)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        pass  # 既に登録済み(同時実行時も含めて安全)


def _ensure_frame_exists(frame_code: str, frame_name: str) -> None:
    """フレームマスタに未登録ならPutする(冪等・競合安全)。"""
    try:
        frames_table.put_item(
            Item={
                "lookupBucket": FRAME_BUCKET,
                "frameCode": frame_code,
                "frameName": frame_name,
            },
            ConditionExpression="attribute_not_exists(frameCode)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        pass  # 既に登録済み(同時実行時も含めて安全)


# ----------------------------------------------------------------------
# 公開関数(MCPツール・Web APIハンドラ双方から呼ばれる)
# ----------------------------------------------------------------------
def list_clients() -> list[dict]:
    """登録済みの全クライアントを一覧取得する(クライアント選択ドロップダウン用)。"""
    resp = clients_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(CLIENT_BUCKET)
    )
    return resp.get("Items", [])


def create_client(client_code: str, client_name: str) -> dict:
    """クライアントを新規登録する(ドロップダウンの「新規作成」操作専用)。

    Series/Frameと異なりタスク作成に先立って単独で登録される操作のため、
    既に存在するclientCodeが指定された場合はConditionalCheckFailedExceptionを
    握りつぶさずClientAlreadyExistsErrorとして呼び出し元に伝える。
    """
    item = {
        "lookupBucket": CLIENT_BUCKET,
        "clientCode": client_code,
        "clientName": client_name,
    }
    try:
        clients_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(clientCode)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        raise ClientAlreadyExistsError(f"clientCode {client_code} は既に登録されています")
    return item


def list_series() -> list[dict]:
    """登録済みの全シリーズを一覧取得する(タスク作成時のドロップダウン用)。"""
    resp = series_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(SERIES_BUCKET)
    )
    return resp.get("Items", [])


def list_frames() -> list[dict]:
    """登録済みの全フレームを一覧取得する(タスク作成時のドロップダウン用)。"""
    resp = frames_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(FRAME_BUCKET)
    )
    return resp.get("Items", [])


def create_task(
    client_code: str,
    series_code: str,
    series_name: str,
    frame_code: str,
    frame_name: str,
    status: str = "未着手",
    assignee: str = "",
    complete_date: Optional[str] = None,
    task_group: str = "",
) -> dict:
    """新しいタスクを作成する。

    series_code/frame_codeが未登録の場合はそれぞれのマスタに自動登録される。
    task_groupはシリーズマスタの属性(表示名: 分類)であり、シリーズが新規登録される
    場合のみ使われる(既存シリーズの場合は_ensure_series_existsが何もしないため無視される)。
    client_codeは自動登録しない(Clientのみ事前にcreate_client()で登録済みであることを前提とする。
    Series/Frameと異なりドロップダウンでの明示的な新規登録操作を持つため)。
    既に同じclientCode+seriesCode+frameCodeのタスクが存在する場合は単純に上書きする。
    """
    now = _now()
    item = {
        "clientCode": client_code,
        "taskKey": _task_key(series_code, frame_code),
        "seriesCode": series_code,
        "frameCode": frame_code,
        "status": status,
        "assignee": assignee,
        "completeDate": complete_date,
        "createdAt": now,
        "updatedAt": now,
    }
    tasks_table.put_item(Item=item)
    _ensure_series_exists(series_code, series_name, task_group)
    _ensure_frame_exists(frame_code, frame_name)
    return item


def get_task(client_code: str, series_code: str, frame_code: str) -> dict:
    """clientCode/seriesCode/frameCodeを指定してタスクを1件取得する。"""
    resp = tasks_table.get_item(
        Key={"clientCode": client_code, "taskKey": _task_key(series_code, frame_code)}
    )
    item = resp.get("Item")
    if not item:
        raise TaskNotFoundError(
            f"タスク(clientCode={client_code}, seriesCode={series_code}, frameCode={frame_code}) が見つかりません"
        )
    return item


def update_task(
    client_code: str,
    series_code: str,
    frame_code: str,
    status: Optional[str] = None,
    assignee: Optional[str] = None,
    complete_date: Optional[str] = None,
) -> dict:
    """既存タスクのステータス・担当者・完了日を更新する(指定した項目のみ変更)。"""
    key = {"clientCode": client_code, "taskKey": _task_key(series_code, frame_code)}
    resp = tasks_table.get_item(Key=key)
    if not resp.get("Item"):
        raise TaskNotFoundError(
            f"タスク(clientCode={client_code}, seriesCode={series_code}, frameCode={frame_code}) が見つかりません"
        )

    update_expr = ["#u = :now"]
    expr_names = {"#u": "updatedAt"}
    expr_values = {":now": _now()}

    if status is not None:
        update_expr.append("#s = :s")
        expr_names["#s"] = "status"
        expr_values[":s"] = status
    if assignee is not None:
        update_expr.append("assignee = :a")
        expr_values[":a"] = assignee
    if complete_date is not None:
        update_expr.append("completeDate = :cd")
        expr_values[":cd"] = complete_date

    resp = tasks_table.update_item(
        Key=key,
        UpdateExpression="SET " + ", ".join(update_expr),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def list_tasks_by_client(client_code: str) -> list[dict]:
    """指定したクライアントコード(完全一致)のタスクを、シリーズ内でフレーム順に一覧取得する。"""
    resp = tasks_table.query(KeyConditionExpression=Key("clientCode").eq(client_code))
    return resp.get("Items", [])
