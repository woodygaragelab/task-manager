"""
task-agent-job-processor
========================
「エージェント」タブの非同期ディスパッチ処理本体。API Gatewayを経由せず、
task-api Lambda(api_src/app.py)から InvocationType="Event" で直接起動される。

Bedrock AgentCore Runtime(receipt-ocr-filelistエージェント)の呼び出しは
数十秒〜数分かかるためAPI Gatewayの30秒制限を超える。このLambda自体は
API Gatewayの背後にいないため、Timeoutを長く(900秒)取ることで対応する。
"""

import json
import os

import boto3
from botocore.config import Config

import task_repository as repo

AGENT_RUNTIME_ARN = os.environ["AGENT_RUNTIME_ARN"]
REGION = os.environ.get("AWS_REGION", "ap-northeast-1")

# botocoreのデフォルトread_timeout(60秒)は実際のAgentCore実行時間より短い。
# これを超えると、サーバー側ではまだ実行中にもかかわらずboto3がクライアント側の
# ソケットタイムアウトを起点に同一runtimeSessionIdへ再送してしまい、Driveへの
# 二重処理につながる恐れがあるため、余裕を持った値に設定し再試行も無効化する。
agent_core_client = boto3.client(
    "bedrock-agentcore",
    region_name=REGION,
    config=Config(connect_timeout=10, read_timeout=850, retries={"max_attempts": 1}),
)


def handler(event, context):
    client_code = event["clientCode"]
    job_id = event["jobId"]
    prompt = event["prompt"]

    # Lambdaの非同期(Event)呼び出しはエラー・タイムアウト時に既定でLambda全体を
    # 再試行するため、対策なしではAgentCore呼び出し(とDrive側の副作用)が同じ
    # job_idに対して繰り返されてしまう。条件付き書き込みでclaimし、競合に勝った
    # 一回のみ処理を進める。
    if not repo.claim_agent_job(client_code, job_id):
        return

    try:
        payload = json.dumps({"prompt": prompt}).encode()
        result = agent_core_client.invoke_agent_runtime(
            agentRuntimeArn=AGENT_RUNTIME_ARN,
            runtimeSessionId=job_id,
            payload=payload,
            qualifier="DEFAULT",
        )
        chunks = list(result.get("response", []))
        raw_bytes = b"".join(chunks)
        try:
            agent_result = json.loads(raw_bytes.decode("utf-8"))
            result_text = agent_result.get("result", "")
        except (UnicodeDecodeError, json.JSONDecodeError):
            result_text = raw_bytes.decode("utf-8", errors="replace")

        repo.complete_agent_job(client_code, job_id, result_text)
    except Exception as e:  # noqa: BLE001 - 失敗内容をポーリング側に残すため常に記録する
        repo.fail_agent_job(client_code, job_id, str(e))
