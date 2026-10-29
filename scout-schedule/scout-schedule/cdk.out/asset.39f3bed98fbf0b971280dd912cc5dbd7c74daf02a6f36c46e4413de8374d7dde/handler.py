import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AGENT_JOB_PROCESSOR_FUNCTION_NAME = os.environ["AGENT_JOB_PROCESSOR_FUNCTION_NAME"]
AGENT_JOBS_TABLE = os.environ["AGENT_JOBS_TABLE"]
CLIENTS_TABLE = os.environ["CLIENTS_TABLE"]

CLIENT_BUCKET = "CLIENT"
AGENT_ID = "progress"
# task_repository.create_agent_job と同じTTL(1日後に自動削除)。
AGENT_JOB_TTL_SECONDS = 60 * 60 * 24

dynamodb = boto3.resource("dynamodb")
agent_jobs_table = dynamodb.Table(AGENT_JOBS_TABLE)
clients_table = dynamodb.Table(CLIENTS_TABLE)
lambda_client = boto3.client("lambda")


def _list_client_codes():
    """登録済みの全関与先コード一覧。

    progress-update(進捗反映)はreceiptFolderIdやsenderEmailsのようなDrive/Gmail連携の
    事前登録を必要とせず、TaskHistory/Tasksのみを対象にするため、scout/archivistと異なり
    絞り込み条件は無い(登録済みの全関与先が対象)。
    """
    resp = clients_table.query(KeyConditionExpression=Key("lookupBucket").eq(CLIENT_BUCKET))
    return sorted(item["clientCode"] for item in resp.get("Items", []))


def _build_prompt(client_code):
    # frontend/src/AgentsPanel.jsx の buildProgressPrompt と同じ文言に揃えること
    # (SKILL.mdはこのプロンプト文言でトリガーするスキルを判定する。関与先コードを
    # 明示することでStep 0の関与先確認(ユーザーへの問い合わせ)をスキップし、
    # 自動実行できるようにしている)。
    return f"{client_code}の進捗を更新して"


def _start_job(client_code, prompt):
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    agent_jobs_table.put_item(
        Item={
            "clientCode": client_code,
            "jobId": job_id,
            "agentId": AGENT_ID,
            "status": "processing",
            "prompt": prompt,
            "createdAt": now,
            "updatedAt": now,
            "ttl": int(datetime.now(timezone.utc).timestamp()) + AGENT_JOB_TTL_SECONDS,
        }
    )
    lambda_client.invoke(
        FunctionName=AGENT_JOB_PROCESSOR_FUNCTION_NAME,
        InvocationType="Event",
        Payload=json.dumps(
            {
                "clientCode": client_code,
                "jobId": job_id,
                "prompt": prompt,
                "agentId": AGENT_ID,
            }
        ).encode(),
    )
    return job_id


def handler(event, context):
    """
    EventBridge Schedulerから呼び出され、progress(progress-update)スキルを
    登録済みの関与先ごとに起動する(scout-schedule/lambda/handler.pyのscout版と
    同じ非同期ジョブディスパッチの仕組み)。
    """
    start = time.time()
    logger.info(json.dumps({"metric": "invoke_start", "agent": AGENT_ID, "phase": "invoke"}))

    job_ids = {}
    failed_client_codes = []

    try:
        client_codes = _list_client_codes()
    except Exception:
        logger.exception(json.dumps({"metric": "list_clients_error", "agent": AGENT_ID}))
        client_codes = []
        failed_client_codes.append("(list_clients)")

    for client_code in client_codes:
        try:
            job_ids[client_code] = _start_job(client_code, _build_prompt(client_code))
        except Exception:
            logger.exception(
                json.dumps(
                    {"metric": "invoke_error", "agent": AGENT_ID, "clientCode": client_code}
                )
            )
            failed_client_codes.append(client_code)

    logger.info(
        json.dumps(
            {
                "metric": "invoke_success" if not failed_client_codes else "invoke_partial_error",
                "agent": AGENT_ID,
                "phase": "invoke",
                "jobIds": job_ids,
                "failedClientCodes": failed_client_codes,
                "duration_ms": int((time.time() - start) * 1000),
            }
        )
    )

    # 一部の関与先の起動に失敗しても例外は投げない(scout-schedule/lambda/handler.py
    # と同じ理由: 例外を投げるとEventBridge Schedulerのretry_policyによりhandler
    # 全体が再実行され、既に起動済みの関与先分のジョブまで新規UUIDで重複起動されて
    # しまう。失敗した関与先はログのinvoke_partial_errorで検知し、次回のスケジュール
    # 実行(6時間後)で拾われる)。
    return {"jobIds": job_ids, "failedClientCodes": failed_client_codes}
