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
        # ---- GET /clients ----
        if route_key == "GET /clients":
            return _response(200, repo.list_clients())

        # ---- POST /clients ----
        if route_key == "POST /clients":
            if "clientCode" not in body or "clientName" not in body:
                return _error(400, "clientCode と clientName は必須です")
            item = repo.create_client(
                client_code=body["clientCode"],
                client_name=body["clientName"],
            )
            return _response(201, item)

        # ---- GET /series ----
        if route_key == "GET /series":
            return _response(200, repo.list_series())

        # ---- GET /frames ----
        if route_key == "GET /frames":
            return _response(200, repo.list_frames())

        # ---- GET /clients/{clientCode}/tasks ----
        if route_key == "GET /clients/{clientCode}/tasks":
            client_code = path_params["clientCode"]
            return _response(200, repo.list_tasks_by_client(client_code))

        # ---- GET /tasks/{clientCode}/{seriesCode}/{frameCode} ----
        if route_key == "GET /tasks/{clientCode}/{seriesCode}/{frameCode}":
            item = repo.get_task(
                client_code=path_params["clientCode"],
                series_code=path_params["seriesCode"],
                frame_code=path_params["frameCode"],
            )
            return _response(200, item)

        # ---- POST /tasks ----
        if route_key == "POST /tasks":
            required = ("clientCode", "seriesCode", "seriesName", "frameCode", "frameName")
            if any(field not in body for field in required):
                return _error(400, "clientCode, seriesCode, seriesName, frameCode, frameName は必須です")
            item = repo.create_task(
                client_code=body["clientCode"],
                series_code=body["seriesCode"],
                series_name=body["seriesName"],
                frame_code=body["frameCode"],
                frame_name=body["frameName"],
                status=body.get("status", "未着手"),
                assignee=body.get("assignee", ""),
                complete_date=body.get("completeDate"),
            )
            return _response(201, item)

        # ---- PATCH /tasks/{clientCode}/{seriesCode}/{frameCode} ----
        if route_key == "PATCH /tasks/{clientCode}/{seriesCode}/{frameCode}":
            item = repo.update_task(
                client_code=path_params["clientCode"],
                series_code=path_params["seriesCode"],
                frame_code=path_params["frameCode"],
                status=body.get("status"),
                assignee=body.get("assignee"),
                complete_date=body.get("completeDate"),
            )
            return _response(200, item)

        return _error(404, f"未対応のルートです: {method} {event.get('rawPath', '')}")

    except repo.ClientAlreadyExistsError as e:
        return _error(409, str(e))
    except repo.TaskNotFoundError as e:
        return _error(404, str(e))
    except (KeyError, ValueError) as e:
        return _error(400, f"リクエストの形式が不正です: {e}")
    except Exception as e:  # noqa: BLE001
        # 想定外のエラー。CloudWatch Logsで詳細を追えるようスタックトレースは
        # Lambdaランタイムのデフォルトログに任せ、レスポンスには概要のみ返す。
        return _error(500, f"内部エラーが発生しました: {e}")
