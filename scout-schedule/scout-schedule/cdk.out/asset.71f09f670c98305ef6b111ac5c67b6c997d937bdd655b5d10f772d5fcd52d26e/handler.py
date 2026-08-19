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

# frontend/src/AgentsPanel.jsx の GLOBAL_CLIENT_CODE と同じダミー関与先コード。
# 関与先ごとのジョブ(下記_list_client_codes)に加えて、senderEmails未登録の関与先や
# どの関与先にも一致しないメール(=未分類、SKILL.md参照)を拾うための受信トレイ全体
# ジョブをここに書き込む。設定ページの「全クライアント」エージェントタブから
# ポーリング確認できる。
GLOBAL_CLIENT_CODE = "ALL"
CLIENT_BUCKET = "CLIENT"
AGENT_ID = "scout"
# scoutスキル(email-summary)の起動トリガー文言。AgentsPanel.jsx の buildScoutPrompt と
# 同じ文言に揃えること(SKILL.md側はこのプロンプト文言でトリガーするスキルを判定する
# ため、ここがズレると別のスキルが呼ばれてしまう。関与先コード付きの場合はStep0の
# senderEmails対応表で検索クエリを絞り込む挙動になる。SKILL.md「対象関与先の指定」参照)。
GLOBAL_PROMPT = "新着メールを処理して"
# task_repository.create_agent_job と同じTTL(1日後に自動削除)。
AGENT_JOB_TTL_SECONDS = 60 * 60 * 24

dynamodb = boto3.resource("dynamodb")
agent_jobs_table = dynamodb.Table(AGENT_JOBS_TABLE)
clients_table = dynamodb.Table(CLIENTS_TABLE)
lambda_client = boto3.client("lambda")


def _list_client_codes():
    """senderEmailsが登録済みの関与先コード一覧(関与先ごとのジョブ分割対象)。

    senderEmails未登録の関与先はGLOBAL_CLIENT_CODEの全体ジョブ側で拾う
    (関与先コード付きで絞り込んでも一致するメールが無いため)。
    """
    resp = clients_table.query(KeyConditionExpression=Key("lookupBucket").eq(CLIENT_BUCKET))
    return sorted(
        item["clientCode"] for item in resp.get("Items", []) if item.get("senderEmails")
    )


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
            {"clientCode": client_code, "jobId": job_id, "prompt": prompt}
        ).encode(),
    )
    return job_id


def handler(event, context):
    """
    EventBridge Schedulerから呼び出され、scout(email-summary)スキルを関与先ごとに
    起動する。

    以前は受信トレイ全体を1本のジョブ(GLOBAL_CLIENT_CODE)にまとめて処理していたが、
    そのままだと結果が設定ページの「全クライアント」エージェントタブでしか確認できず、
    各関与先のエージェントタブには反映されなかった。そこでTaskClientsから
    senderEmails登録済みの関与先を取得し、関与先コード付きのジョブを1件ずつ起動する
    (AgentsPanel.jsxが手動起動時に使うbuildScoutPrompt(client)と同じ文言・同じ
    clientCodeキーでTaskAgentJobsに書き込むため、各関与先タブのポーリングは変更不要)。
    senderEmails未登録の関与先やどの関与先にも一致しないメール(未分類)を拾うため、
    従来通りのGLOBAL_CLIENT_CODEジョブも合わせて1本起動する。

    AgentCore Runtimeへの直接同期呼び出しは数十秒〜数分かかりうるため、Web版の
    「エージェント」タブ(AgentsPanel.jsx)と同じ非同期ジョブの仕組みに乗せる:
    TaskAgentJobsにジョブを登録したうえで、実際のAgentCore呼び出しを担う
    taskmanager-agent-job-processor(api_src/app.pyのPOST /agent-jobsが使うのと
    同じLambda)をEvent(非同期)呼び出しする。
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
            job_ids[client_code] = _start_job(client_code, f"{client_code}の新着メールを処理して")
        except Exception:
            logger.exception(
                json.dumps(
                    {"metric": "invoke_error", "agent": AGENT_ID, "clientCode": client_code}
                )
            )
            failed_client_codes.append(client_code)

    try:
        job_ids[GLOBAL_CLIENT_CODE] = _start_job(GLOBAL_CLIENT_CODE, GLOBAL_PROMPT)
    except Exception:
        logger.exception(
            json.dumps(
                {"metric": "invoke_error", "agent": AGENT_ID, "clientCode": GLOBAL_CLIENT_CODE}
            )
        )
        failed_client_codes.append(GLOBAL_CLIENT_CODE)

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

    if failed_client_codes:
        raise RuntimeError(f"scoutジョブの起動に失敗した関与先があります: {failed_client_codes}")

    return {"jobIds": job_ids}
