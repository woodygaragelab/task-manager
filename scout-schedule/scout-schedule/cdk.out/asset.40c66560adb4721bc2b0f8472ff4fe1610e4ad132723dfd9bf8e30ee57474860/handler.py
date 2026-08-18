import json
import logging
import os
import time
import uuid
from datetime import datetime, timezone

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AGENT_JOB_PROCESSOR_FUNCTION_NAME = os.environ["AGENT_JOB_PROCESSOR_FUNCTION_NAME"]
AGENT_JOBS_TABLE = os.environ["AGENT_JOBS_TABLE"]

# frontend/src/AgentsPanel.jsx の GLOBAL_CLIENT_CODE と同じダミー関与先コード。
# ここに書き込むことで、定期実行の結果を設定ページの「全クライアント」エージェント
# タブからポーリング確認できる。
GLOBAL_CLIENT_CODE = "ALL"
AGENT_ID = "scout"
# scoutスキル(email-summary)を関与先未指定・受信トレイ全体で起動するトリガー文言。
# AgentsPanel.jsx の buildScoutPrompt(client=null) と同じ文言に揃えること
# (SKILL.md側はこのプロンプト文言でトリガーするスキルを判定するため、ここがズレると
# 別のスキルが呼ばれてしまう)。
PROMPT = "新着メールを処理して"
# task_repository.create_agent_job と同じTTL(1日後に自動削除)。
AGENT_JOB_TTL_SECONDS = 60 * 60 * 24

dynamodb = boto3.resource("dynamodb")
agent_jobs_table = dynamodb.Table(AGENT_JOBS_TABLE)
lambda_client = boto3.client("lambda")


def handler(event, context):
    """
    EventBridge Schedulerから呼び出され、scout(email-summary)スキルを
    受信トレイ全体・関与先未指定で起動する。

    AgentCore Runtimeへの直接同期呼び出しは数十秒〜数分かかりうるため、Web版の
    「エージェント」タブ(AgentsPanel.jsx)と同じ非同期ジョブの仕組みに乗せる:
    TaskAgentJobsにジョブを登録したうえで、実際のAgentCore呼び出しを担う
    taskmanager-agent-job-processor(api_src/app.pyのPOST /agent-jobsが使うのと
    同じLambda)をEvent(非同期)呼び出しする。
    """
    start = time.time()
    job_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()

    logger.info(
        json.dumps(
            {
                "metric": "invoke_start",
                "agent": AGENT_ID,
                "phase": "invoke",
                "jobId": job_id,
            }
        )
    )

    try:
        agent_jobs_table.put_item(
            Item={
                "clientCode": GLOBAL_CLIENT_CODE,
                "jobId": job_id,
                "agentId": AGENT_ID,
                "status": "processing",
                "prompt": PROMPT,
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
                    "clientCode": GLOBAL_CLIENT_CODE,
                    "jobId": job_id,
                    "prompt": PROMPT,
                }
            ).encode(),
        )

        logger.info(
            json.dumps(
                {
                    "metric": "invoke_success",
                    "agent": AGENT_ID,
                    "phase": "invoke",
                    "jobId": job_id,
                    "duration_ms": int((time.time() - start) * 1000),
                }
            )
        )
        return {"jobId": job_id}

    except Exception:
        logger.exception(
            json.dumps(
                {
                    "metric": "invoke_error",
                    "agent": AGENT_ID,
                    "phase": "invoke",
                    "jobId": job_id,
                    "duration_ms": int((time.time() - start) * 1000),
                }
            )
        )
        raise
