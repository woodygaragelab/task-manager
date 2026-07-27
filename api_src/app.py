"""
task-api
========
社内Webアプリ用の REST API。API Gateway(HTTP API)+ Cognito JWT Authorizer の
背後で動く Lambda 本体。

CRUDロジック本体は共通モジュール task_repository(Lambda Layer)を呼ぶだけで、
task-mcp-server と同じDynamoDBテーブルを直接参照・更新する。
認証(JWT検証)自体はAPI Gateway側のCognitoオーソライザーが行うため、
ここでは認可後のリクエストのみを扱う。
"""

import json
from typing import Any

import task_repository as repo


def _response(status_code: int, body: Any) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            # 社内利用のみだが、フロントエンドのオリジンを後で限定する想定でCORSヘッダを用意
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
        },
        "body": json.dumps(body, ensure_ascii=False, default=str),
    }


def _error(status_code: int, message: str) -> dict:
    return _response(status_code, {"error": message})


def handler(event, context):
    method = event["requestContext"]["http"]["method"]
    route_key = event.get("routeKey", "")
    path_params = event.get("pathParameters") or {}
    query_params = event.get("queryStringParameters") or {}

    try:
        body = json.loads(event["body"]) if event.get("body") else {}
    except json.JSONDecodeError:
        return _error(400, "リクエストボディのJSON解析に失敗しました")

    try:
        # ---- GET /customers/{clientCode} ----
        if route_key == "GET /customers/{clientCode}":
            client_code = path_params["clientCode"]
            return _response(200, repo.get_client_by_code(client_code))

        # ---- GET /customers/{clientCode}/tasks ----
        if route_key == "GET /customers/{clientCode}/tasks":
            client_code = path_params["clientCode"]
            return _response(200, repo.list_tasks_by_client(client_code))

        # ---- GET /tasks/{taskId} ----
        if route_key == "GET /tasks/{taskId}":
            task_id = int(path_params["taskId"])
            return _response(200, repo.get_task(task_id))

        # ---- POST /tasks ----
        if route_key == "POST /tasks":
            if "clientCode" not in body or "clientName" not in body or "taskName" not in body:
                return _error(400, "clientCode と clientName と taskName は必須です")
            item = repo.create_task(
                client_code=body["clientCode"],
                client_name=body["clientName"],
                task_name=body["taskName"],
                status=body.get("status", "要対応"),
                due_date=body.get("dueDate", "-"),
                conclusion=body.get("conclusion", ""),
                assignee=body.get("assignee", ""),
                thread_ids=body.get("threadIds"),
            )
            return _response(201, item)

        # ---- PATCH /tasks/{taskId} ----
        if route_key == "PATCH /tasks/{taskId}":
            task_id = int(path_params["taskId"])
            item = repo.update_task(
                task_id=task_id,
                status=body.get("status"),
                conclusion=body.get("conclusion"),
                due_date=body.get("dueDate"),
                assignee=body.get("assignee"),
            )
            return _response(200, item)

        # ---- POST /tasks/{taskId}/emails ----
        if route_key == "POST /tasks/{taskId}/emails":
            task_id = int(path_params["taskId"])
            if "threadId" not in body:
                return _error(400, "threadId は必須です")
            item = repo.link_email(task_id=task_id, thread_id=body["threadId"])
            return _response(200, item)

        return _error(404, f"未対応のルートです: {method} {event.get('rawPath', '')}")

    except repo.TaskNotFoundError as e:
        return _error(404, str(e))
    except (KeyError, ValueError) as e:
        return _error(400, f"リクエストの形式が不正です: {e}")
    except Exception as e:  # noqa: BLE001
        # 想定外のエラー。CloudWatch Logsで詳細を追えるようスタックトレースは
        # Lambdaランタイムのデフォルトログに任せ、レスポンスには概要のみ返す。
        return _error(500, f"内部エラーが発生しました: {e}")
