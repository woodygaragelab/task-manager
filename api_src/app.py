"""
task-api
========
社内Webアプリ用の REST API。API Gateway(HTTP API)+ Cognito JWT Authorizer の
背後で動く Lambda 本体。

CRUDロジック本体は共通モジュール task_repository(Lambda Layer)を呼ぶだけで、
taskmanager-mcp(MCPサーバー)と同じDynamoDBテーブルを直接参照・更新する。
認証(JWT検証)自体はAPI Gateway側のCognitoオーソライザーが行うため、
ここでは認可後のリクエストのみを扱う。
"""

import json
import os
from typing import Any

import boto3

import google_drive
import task_repository as repo

lambda_client = boto3.client("lambda")
AGENT_JOB_PROCESSOR_FUNCTION_NAME = os.environ["AGENT_JOB_PROCESSOR_FUNCTION_NAME"]
CLIENT_DRIVE_PARENT_FOLDER_ID = os.environ["CLIENT_DRIVE_PARENT_FOLDER_ID"]
CLIENT_FOLDER_TEMPLATE_ID = os.environ["CLIENT_FOLDER_TEMPLATE_ID"]


def _response(status_code: int, body: Any) -> dict:
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            # 社内利用のみだが、フロントエンドのオリジンを後で限定する想定でCORSヘッダを用意
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Authorization,Content-Type",
            "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
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
            custom_fields = {code: body.get(code) for code in repo.CUSTOM_FIELD_CODES}
            item = repo.create_client(
                client_code=body["clientCode"],
                client_name=body["clientName"],
                receipt_folder_id=body.get("receiptFolderId"),
                renamed_folder_id=body.get("renamedFolderId"),
                assignee=body.get("assignee"),
                fiscal_year_end_month=body.get("fiscalYearEndMonth"),
                three_months_after_month=body.get("threeMonthsAfterMonth"),
                interim_month=body.get("interimMonth"),
                nine_months_after_month=body.get("nineMonthsAfterMonth"),
                sender_emails=body.get("senderEmails"),
                uketori_folder_id=body.get("uketoriFolderId"),
                engagement_type=body.get("engagementType"),
                payment_method=body.get("paymentMethod"),
                **custom_fields,
            )
            return _response(201, item)

        # ---- PATCH /clients/{clientCode} ----
        if route_key == "PATCH /clients/{clientCode}":
            custom_fields = {code: body.get(code) for code in repo.CUSTOM_FIELD_CODES}
            item = repo.update_client(
                client_code=path_params["clientCode"],
                client_name=body.get("clientName"),
                receipt_folder_id=body.get("receiptFolderId"),
                renamed_folder_id=body.get("renamedFolderId"),
                assignee=body.get("assignee"),
                fiscal_year_end_month=body.get("fiscalYearEndMonth"),
                three_months_after_month=body.get("threeMonthsAfterMonth"),
                interim_month=body.get("interimMonth"),
                nine_months_after_month=body.get("nineMonthsAfterMonth"),
                sender_emails=body.get("senderEmails"),
                uketori_folder_id=body.get("uketoriFolderId"),
                engagement_type=body.get("engagementType"),
                payment_method=body.get("paymentMethod"),
                **custom_fields,
            )
            return _response(200, item)

        # ---- DELETE /clients/{clientCode} ----
        if route_key == "DELETE /clients/{clientCode}":
            repo.delete_client(client_code=path_params["clientCode"])
            return _response(200, {"clientCode": path_params["clientCode"]})

        # ---- POST /clients/{clientCode}/drive-folder ----
        if route_key == "POST /clients/{clientCode}/drive-folder":
            client_code = path_params["clientCode"]
            result = google_drive.initialize_client_folder(
                client_code, CLIENT_DRIVE_PARENT_FOLDER_ID, CLIENT_FOLDER_TEMPLATE_ID
            )
            # 作成した受領/整理済フォルダのIDを、クライアントの領収書フォルダ/
            # 分類後フォルダ欄にそのまま反映する。受領フォルダ(uketoriFolderId)も
            # 同じフォルダを共用する。
            updated_client = repo.update_client(
                client_code=client_code,
                receipt_folder_id=result["receiptFolderId"],
                renamed_folder_id=result["renamedFolderId"],
                uketori_folder_id=result["receiptFolderId"],
            )
            return _response(201, updated_client)

        # ---- GET /client-field-labels ----
        if route_key == "GET /client-field-labels":
            return _response(200, repo.get_client_field_labels())

        # ---- PATCH /client-field-labels ----
        if route_key == "PATCH /client-field-labels":
            return _response(200, repo.update_client_field_labels(body))

        # ---- GET /tab-comments ----
        if route_key == "GET /tab-comments":
            return _response(200, repo.get_tab_comments())

        # ---- PATCH /tab-comments/{tabKey} ----
        if route_key == "PATCH /tab-comments/{tabKey}":
            item = repo.update_tab_comment(
                tab_key=path_params["tabKey"],
                comment=body.get("comment", ""),
            )
            return _response(200, item)

        # ---- GET /series ----
        if route_key == "GET /series":
            return _response(200, repo.list_series())

        # ---- POST /series ----
        if route_key == "POST /series":
            if "seriesCode" not in body or "seriesName" not in body:
                return _error(400, "seriesCode と seriesName は必須です")
            item = repo.create_series(
                series_code=body["seriesCode"],
                series_name=body["seriesName"],
                task_group=body.get("taskGroup", ""),
            )
            return _response(201, item)

        # ---- PATCH /series/{seriesCode} ----
        if route_key == "PATCH /series/{seriesCode}":
            item = repo.update_series(
                series_code=path_params["seriesCode"],
                series_name=body.get("seriesName"),
                task_group=body.get("taskGroup"),
            )
            return _response(200, item)

        # ---- DELETE /series/{seriesCode} ----
        if route_key == "DELETE /series/{seriesCode}":
            repo.delete_series(series_code=path_params["seriesCode"])
            return _response(200, {"seriesCode": path_params["seriesCode"]})

        # ---- GET /frames ----
        if route_key == "GET /frames":
            return _response(200, repo.list_frames())

        # ---- POST /frames ----
        if route_key == "POST /frames":
            if "frameCode" not in body or "frameName" not in body:
                return _error(400, "frameCode と frameName は必須です")
            item = repo.create_frame(
                frame_code=body["frameCode"],
                frame_name=body["frameName"],
            )
            return _response(201, item)

        # ---- PATCH /frames/{frameCode} ----
        if route_key == "PATCH /frames/{frameCode}":
            item = repo.update_frame(
                frame_code=path_params["frameCode"],
                frame_name=body.get("frameName"),
            )
            return _response(200, item)

        # ---- DELETE /frames/{frameCode} ----
        if route_key == "DELETE /frames/{frameCode}":
            repo.delete_frame(frame_code=path_params["frameCode"])
            return _response(200, {"frameCode": path_params["frameCode"]})

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
                task_group=body.get("taskGroup", ""),
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

        # ---- DELETE /tasks/{clientCode}/{seriesCode}/{frameCode} ----
        if route_key == "DELETE /tasks/{clientCode}/{seriesCode}/{frameCode}":
            repo.delete_task(
                client_code=path_params["clientCode"],
                series_code=path_params["seriesCode"],
                frame_code=path_params["frameCode"],
            )
            return _response(200, {"frameCode": path_params["frameCode"]})

        # ---- GET /clients/{clientCode}/history ----
        if route_key == "GET /clients/{clientCode}/history":
            return _response(200, repo.list_history(client_code=path_params["clientCode"]))

        # ---- POST /clients/{clientCode}/history ----
        if route_key == "POST /clients/{clientCode}/history":
            if "date" not in body:
                return _error(400, "date は必須です")
            item = repo.create_history_entry(
                client_code=path_params["clientCode"],
                date=body["date"],
                category=body.get("category", ""),
                series_code=body.get("seriesCode", ""),
                frame_codes=body.get("frameCodes", []),
                assignee=body.get("assignee", ""),
                status=body.get("status", ""),
                content=body.get("content", ""),
                classifications=body.get("classifications"),
            )
            return _response(201, item)

        # ---- PATCH /clients/{clientCode}/history/{historyId} ----
        if route_key == "PATCH /clients/{clientCode}/history/{historyId}":
            item = repo.update_history_entry(
                client_code=path_params["clientCode"],
                history_id=path_params["historyId"],
                date=body.get("date"),
                category=body.get("category"),
                series_code=body.get("seriesCode"),
                frame_codes=body.get("frameCodes"),
                assignee=body.get("assignee"),
                status=body.get("status"),
                content=body.get("content"),
                classifications=body.get("classifications"),
            )
            return _response(200, item)

        # ---- DELETE /clients/{clientCode}/history/{historyId} ----
        if route_key == "DELETE /clients/{clientCode}/history/{historyId}":
            repo.delete_history_entry(
                client_code=path_params["clientCode"],
                history_id=path_params["historyId"],
            )
            return _response(200, {"historyId": path_params["historyId"]})

        # ---- POST /clients/{clientCode}/agent-jobs ----
        if route_key == "POST /clients/{clientCode}/agent-jobs":
            if "agentId" not in body or "prompt" not in body:
                return _error(400, "agentId と prompt は必須です")
            client_code = path_params["clientCode"]
            item = repo.create_agent_job(
                client_code=client_code,
                agent_id=body["agentId"],
                prompt=body["prompt"],
            )
            # AgentCore呼び出しは数十秒〜数分かかりAPI Gatewayの30秒制限を超えうるため、
            # ジョブ登録のみここで完了させ、実処理は非同期(Event)呼び出しの別Lambdaに委ねる。
            lambda_client.invoke(
                FunctionName=AGENT_JOB_PROCESSOR_FUNCTION_NAME,
                InvocationType="Event",
                Payload=json.dumps(
                    {
                        "clientCode": client_code,
                        "jobId": item["jobId"],
                        "prompt": item["prompt"],
                    }
                ).encode(),
            )
            return _response(202, item)

        # ---- GET /clients/{clientCode}/agent-jobs ----
        if route_key == "GET /clients/{clientCode}/agent-jobs":
            return _response(
                200,
                repo.list_agent_jobs(
                    client_code=path_params["clientCode"],
                    agent_id=query_params.get("agentId"),
                ),
            )

        # ---- GET /clients/{clientCode}/agent-jobs/{jobId} ----
        if route_key == "GET /clients/{clientCode}/agent-jobs/{jobId}":
            item = repo.get_agent_job(
                client_code=path_params["clientCode"],
                job_id=path_params["jobId"],
            )
            return _response(200, item)

        # ---- GET /classification-axes ----
        if route_key == "GET /classification-axes":
            return _response(200, repo.list_classification_axes())

        # ---- POST /classification-axes ----
        if route_key == "POST /classification-axes":
            if "axisId" not in body or "label" not in body:
                return _error(400, "axisId と label は必須です")
            item = repo.create_classification_axis(
                axis_id=body["axisId"],
                label=body["label"],
            )
            return _response(201, item)

        # ---- PATCH /classification-axes/{axisId} ----
        if route_key == "PATCH /classification-axes/{axisId}":
            item = repo.update_classification_axis(
                axis_id=path_params["axisId"],
                label=body.get("label"),
            )
            return _response(200, item)

        # ---- DELETE /classification-axes/{axisId} ----
        if route_key == "DELETE /classification-axes/{axisId}":
            repo.delete_classification_axis(axis_id=path_params["axisId"])
            return _response(200, {"axisId": path_params["axisId"]})

        # ---- GET /classification-axes/{axisId}/rules ----
        if route_key == "GET /classification-axes/{axisId}/rules":
            return _response(200, repo.list_classification_rules(axis_id=path_params["axisId"]))

        # ---- POST /classification-axes/{axisId}/rules ----
        if route_key == "POST /classification-axes/{axisId}/rules":
            if "category" not in body or "pattern" not in body:
                return _error(400, "category と pattern は必須です")
            item = repo.create_classification_rule(
                axis_id=path_params["axisId"],
                category=body["category"],
                pattern=body["pattern"],
                match_type=body.get("matchType", "keyword"),
                priority=body.get("priority", 0),
            )
            return _response(201, item)

        # ---- PATCH /classification-axes/{axisId}/rules/{ruleId} ----
        if route_key == "PATCH /classification-axes/{axisId}/rules/{ruleId}":
            item = repo.update_classification_rule(
                axis_id=path_params["axisId"],
                rule_id=path_params["ruleId"],
                category=body.get("category"),
                pattern=body.get("pattern"),
                match_type=body.get("matchType"),
                priority=body.get("priority"),
            )
            return _response(200, item)

        # ---- DELETE /classification-axes/{axisId}/rules/{ruleId} ----
        if route_key == "DELETE /classification-axes/{axisId}/rules/{ruleId}":
            repo.delete_classification_rule(
                axis_id=path_params["axisId"],
                rule_id=path_params["ruleId"],
            )
            return _response(200, {"ruleId": path_params["ruleId"]})

        # ---- POST /classify ----
        if route_key == "POST /classify":
            if "text" not in body:
                return _error(400, "text は必須です")
            text = body["text"]
            result = {"results": repo.classify(text=text)}
            year = body.get("year")
            if year:
                result["frameCodes"] = repo.extract_frame_codes(text=text, year=year)
            return _response(200, result)

        return _error(404, f"未対応のルートです: {method} {event.get('rawPath', '')}")

    except repo.ClientAlreadyExistsError as e:
        return _error(409, str(e))
    except repo.ClientNotFoundError as e:
        return _error(404, str(e))
    except repo.SeriesAlreadyExistsError as e:
        return _error(409, str(e))
    except repo.SeriesNotFoundError as e:
        return _error(404, str(e))
    except repo.FrameAlreadyExistsError as e:
        return _error(409, str(e))
    except repo.FrameNotFoundError as e:
        return _error(404, str(e))
    except repo.TaskNotFoundError as e:
        return _error(404, str(e))
    except repo.HistoryEntryNotFoundError as e:
        return _error(404, str(e))
    except repo.AgentJobNotFoundError as e:
        return _error(404, str(e))
    except repo.ClassificationAxisAlreadyExistsError as e:
        return _error(409, str(e))
    except repo.ClassificationAxisNotFoundError as e:
        return _error(404, str(e))
    except repo.ClassificationRuleNotFoundError as e:
        return _error(404, str(e))
    except (KeyError, ValueError) as e:
        return _error(400, f"リクエストの形式が不正です: {e}")
    except Exception as e:  # noqa: BLE001
        # 想定外のエラー。CloudWatch Logsで詳細を追えるようスタックトレースは
        # Lambdaランタイムのデフォルトログに任せ、レスポンスには概要のみ返す。
        return _error(500, f"内部エラーが発生しました: {e}")
