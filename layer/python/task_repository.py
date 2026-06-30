"""
task_repository
================
DynamoDB(Tasks / TaskCases / TaskCounters)に対するCRUDロジックの共通モジュール。

task-mcp-server(FastMCP)と task-api(Web API用Lambda)の両方から
Lambda Layer として import される。ロジックの二重実装を避けるため、
MCPツールのデコレータや Web API のルーティングには一切依存しない
プレーンな関数のみをここに置く。
"""

import os
from datetime import datetime, timezone
from typing import Optional

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
tasks_table = dynamodb.Table(os.environ["TASKS_TABLE"])
cases_table = dynamodb.Table(os.environ["CASES_TABLE"])
counters_table = dynamodb.Table(os.environ["COUNTERS_TABLE"])

STATUS_RANK = {"要対応": 0, "決定済": 1, "情報": 2, "完了": 3}
DEFAULT_DUE = "9999-12-31"
LOOKUP_BUCKET = "CASE"


class TaskNotFoundError(Exception):
    """指定されたtaskIdが存在しない場合に送出する。"""


# ----------------------------------------------------------------------
# 内部ヘルパー
# ----------------------------------------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _status_sort(status: str, due_date: Optional[str], task_id: int) -> str:
    rank = STATUS_RANK.get(status, 9)
    due = due_date if due_date and due_date != "-" else DEFAULT_DUE
    return f"{rank}#{due}#{task_id:06d}"


def _next_task_id() -> int:
    resp = counters_table.update_item(
        Key={"counterName": "taskId"},
        UpdateExpression="ADD #v :inc",
        ExpressionAttributeNames={"#v": "value"},
        ExpressionAttributeValues={":inc": 1},
        ReturnValues="UPDATED_NEW",
    )
    return int(resp["Attributes"]["value"])


def _ensure_case_exists(customer_name: str) -> None:
    """案件マスタ(Casesテーブル)に未登録ならPutする(冪等・競合安全)。"""
    try:
        cases_table.put_item(
            Item={"lookupBucket": LOOKUP_BUCKET, "customerName": customer_name},
            ConditionExpression="attribute_not_exists(customerName)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        pass  # 既に登録済み(同時実行時も含めて安全)


# ----------------------------------------------------------------------
# 公開関数(MCPツール・Web APIハンドラ双方から呼ばれる)
# ----------------------------------------------------------------------
def create_task(
    customer_name: str,
    task_name: str,
    status: str = "要対応",
    due_date: str = "-",
    conclusion: str = "",
    assignee: str = "",
    thread_ids: Optional[list[str]] = None,
) -> dict:
    """新しいタスクを作成する。customer_name は必須(案件マスタに自動登録される)。"""
    task_id = _next_task_id()
    now = _now()
    item = {
        "taskId": task_id,
        "customerName": customer_name,
        "taskName": task_name,
        "status": status,
        "dueDate": due_date,
        "conclusion": conclusion,
        "assignee": assignee,
        "sourceThreadIds": thread_ids or [],
        "dependsOn": [],
        "statusSort": _status_sort(status, due_date, task_id),
        "createdAt": now,
        "updatedAt": now,
    }
    tasks_table.put_item(Item=item)
    _ensure_case_exists(customer_name)
    return item


def get_task(task_id: int) -> dict:
    """taskIdを指定してタスクを1件取得する。"""
    resp = tasks_table.get_item(Key={"taskId": task_id})
    item = resp.get("Item")
    if not item:
        raise TaskNotFoundError(f"taskId {task_id} が見つかりません")
    return item


def update_task(
    task_id: int,
    status: Optional[str] = None,
    conclusion: Optional[str] = None,
    due_date: Optional[str] = None,
    assignee: Optional[str] = None,
) -> dict:
    """既存タスクのステータス・結論・期限・担当者を更新する(指定した項目のみ変更)。"""
    resp = tasks_table.get_item(Key={"taskId": task_id})
    current = resp.get("Item")
    if not current:
        raise TaskNotFoundError(f"taskId {task_id} が見つかりません")

    new_status = status if status is not None else current["status"]
    new_due = due_date if due_date is not None else current["dueDate"]

    update_expr = ["#u = :now", "#ss = :ss"]
    expr_names = {"#u": "updatedAt", "#ss": "statusSort"}
    expr_values = {":now": _now(), ":ss": _status_sort(new_status, new_due, task_id)}

    if status is not None:
        update_expr.append("#s = :s")
        expr_names["#s"] = "status"
        expr_values[":s"] = status
    if conclusion is not None:
        update_expr.append("conclusion = :c")
        expr_values[":c"] = conclusion
    if due_date is not None:
        update_expr.append("dueDate = :d")
        expr_values[":d"] = due_date
    if assignee is not None:
        update_expr.append("assignee = :a")
        expr_values[":a"] = assignee

    resp = tasks_table.update_item(
        Key={"taskId": task_id},
        UpdateExpression="SET " + ", ".join(update_expr),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def list_tasks_by_customer(customer_name: str) -> list[dict]:
    """指定した案件名(完全一致)のタスクを、ステータス順(要対応→決定済→情報→完了)・期限順で一覧取得する。"""
    resp = tasks_table.query(
        IndexName="CustomerStatusIndex",
        KeyConditionExpression=Key("customerName").eq(customer_name),
    )
    return resp.get("Items", [])


def search_customer_names(prefix: str) -> list[str]:
    """案件名を前方一致で検索し、候補一覧を返す(例: 'GI' -> 'GI商事 Webサイト更新案件' など)。"""
    resp = cases_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(LOOKUP_BUCKET)
        & Key("customerName").begins_with(prefix)
    )
    return [item["customerName"] for item in resp.get("Items", [])]


def link_email(task_id: int, thread_id: str) -> dict:
    """タスクにGmailスレッドIDを追加で紐づける(関連メール表示用)。"""
    resp = tasks_table.update_item(
        Key={"taskId": task_id},
        UpdateExpression=(
            "SET sourceThreadIds = list_append("
            "if_not_exists(sourceThreadIds, :empty), :tid), updatedAt = :now"
        ),
        ExpressionAttributeValues={
            ":tid": [thread_id],
            ":empty": [],
            ":now": _now(),
        },
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]
