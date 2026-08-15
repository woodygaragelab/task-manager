import json
import logging
import os
import time

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

AGENT_RUNTIME_ARN = os.environ["AGENT_RUNTIME_ARN"]

client = boto3.client("bedrock-agentcore", region_name="ap-northeast-1")


def handler(event, context):
    """
    EventBridge Schedulerから呼び出され、AgentCore Runtime上のscout
    (email-summary)スキルを受信トレイ全体・関与先未指定で起動する。

    ペイロード形式(payload)は、エージェントタブから「未指定起動」した際に
    実際にtask_agent.py側が受け取っているリクエスト構造に合わせて調整すること。
    ここでは仮に {"skill": "email-summary"} としている。
    """
    start = time.time()
    payload = {"skill": "email-summary"}

    logger.info(
        json.dumps(
            {
                "metric": "invoke_start",
                "agent": "scout",
                "phase": "invoke",
                "payload": payload,
            }
        )
    )

    try:
        response = client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            payload=json.dumps(payload).encode("utf-8"),
        )
        body = response["response"].read()
        result = json.loads(body) if body else {}

        logger.info(
            json.dumps(
                {
                    "metric": "invoke_success",
                    "agent": "scout",
                    "phase": "invoke",
                    "duration_ms": int((time.time() - start) * 1000),
                }
            )
        )
        return result

    except Exception:
        logger.exception(
            json.dumps(
                {
                    "metric": "invoke_error",
                    "agent": "scout",
                    "phase": "invoke",
                    "duration_ms": int((time.time() - start) * 1000),
                }
            )
        )
        raise
