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
import re

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

# receipt-ocr-filelistは1回の実行で最大10ファイルしか処理せず、残りがあれば報告の
# 最終行に `REMAINING: N` を出す。N>0の間、1ラウンド=1回のLambda起動として、自分自身を
# 非同期(Event)で再起動し次の10件を新しいセッション(=新しいコンテキスト)で処理する。
# ラウンドごとに別のLambda起動になるので、全体の所要時間はLambdaの900秒に縛られない。
REMAINING_RE = re.compile(r"^\s*REMAINING:\s*(\d+)\s*$", re.MULTILINE)
MAX_ROUNDS = 50
# 非同期呼び出しのペイロード上限(256KB)対策。累積結果がこれを超えたら古い側を切り詰める。
MAX_ACCUMULATED_CHARS = 60000

# Bedrock側の一時的な障害(503 "unable to process your request"、529 overloaded、
# スロットリング等)や応答待ちタイムアウトは、同じラウンドをやり直せば通ることが多い。
# 処理済みファイルは受領ファイル一覧で判定されるため、やり直しても重複コピーは発生しない。
# 失敗したラウンドは長時間(数百秒)掛かっていることがあり同じLambda内では再試行できない
# ため、ラウンドを進めずに自分自身を再起動してやり直す。
MAX_RETRIES_PER_ROUND = 3
TRANSIENT_ERROR_RE = re.compile(
    r"\b(500|502|503|504|529)\b|unable to process your request|overloaded|throttl|"
    r"ServiceUnavailable|ModelNotReady|Read timeout|timed out|Connection reset",
    re.IGNORECASE,
)

lambda_client = boto3.client("lambda", region_name=REGION)


def handler(event, context):
    client_code = event["clientCode"]
    job_id = event["jobId"]
    prompt = event["prompt"]
    # コスト管理用。トリガー元(scout/archivist/progress/Web UI)がTaskAgentJobsに
    # 書き込んだagentIdをそのまま転送し、task_agent.py側でエージェント別の
    # LLM呼び出しコストをログに残せるようにする(古いイベント形式との互換のため
    # 未指定時はprompt先頭10文字にフォールバックする。"unknown"で固定すると
    # ログ上でどの呼び出しか区別できなくなるため)。
    agent_id = event.get("agentId") or prompt[:10]
    # 2ラウンド目以降は自己再起動で呼ばれる(round/prevRemaining/accumulatedを引き継ぐ)。
    round_no = event.get("round", 1)
    prev_remaining = event.get("prevRemaining")
    accumulated = event.get("accumulated", "")
    retry_no = event.get("retry", 0)

    # Lambdaの非同期(Event)呼び出しはエラー・タイムアウト時に既定でLambda全体を
    # 再試行するため、対策なしではAgentCore呼び出し(とDrive側の副作用)が同じ
    # job_idに対して繰り返されてしまう。条件付き書き込みでclaimし、競合に勝った
    # 一回のみ処理を進める。claimはジョブ単位なので、自己再起動の2ラウンド目以降は
    # 既にclaim済みのため行わない。
    if round_no == 1 and not repo.claim_agent_job(client_code, job_id):
        return

    try:
        # 1ラウンド=新しいruntimeSessionId。round 1 は従来どおり job_id をそのまま使う。
        session_id = job_id if round_no == 1 else f"{job_id}-{round_no}"
        if retry_no:
            session_id = f"{session_id}-r{retry_no}"
        try:
            round_text = _invoke_round(session_id, prompt, agent_id, client_code, job_id)
        except Exception as e:  # noqa: BLE001
            if retry_no >= MAX_RETRIES_PER_ROUND or not TRANSIENT_ERROR_RE.search(str(e)):
                raise
            print(f"[retry] round={round_no} retry={retry_no + 1}/{MAX_RETRIES_PER_ROUND} error={e}")
            _reinvoke(context, {**event, "agentId": agent_id, "retry": retry_no + 1})
            return
        results = accumulated + (round_text if round_no == 1 else f"\n\n--- {round_no}回目 ---\n{round_text}")
        if len(results) > MAX_ACCUMULATED_CHARS:
            results = "(前半省略)\n" + results[-MAX_ACCUMULATED_CHARS:]

        remaining = _parse_remaining(round_text)
        stop_reason = None
        if remaining:
            if prev_remaining is not None and remaining >= prev_remaining:
                stop_reason = f"残り{remaining}件が前回から減らないため自動再実行を止めました。"
            elif round_no >= MAX_ROUNDS:
                stop_reason = f"自動再実行の上限({MAX_ROUNDS}回)に達しました。残り{remaining}件は未処理です。"
        if remaining and not stop_reason:
            repo.update_agent_job_progress(client_code, job_id, round_no, remaining, results)
            _reinvoke(
                context,
                {
                    **event,
                    "agentId": agent_id,
                    "round": round_no + 1,
                    "retry": 0,
                    "prevRemaining": remaining,
                    "accumulated": results,
                },
            )
            return  # ジョブは「実行中」のまま。最終ラウンドがcomplete/failを記録する。

        if stop_reason:
            results += f"\n\n[中断] {stop_reason}再実行してください。"
        repo.complete_agent_job(client_code, job_id, results)
    except Exception as e:  # noqa: BLE001 - 失敗内容をポーリング側に残すため常に記録する
        repo.fail_agent_job(client_code, job_id, str(e))


def _reinvoke(context, event):
    lambda_client.invoke(
        FunctionName=context.function_name,
        InvocationType="Event",
        Payload=json.dumps(event).encode(),
    )


def _invoke_round(session_id, prompt, agent_id, client_code, job_id):
    payload = json.dumps(
        {
            "prompt": prompt,
            "agentId": agent_id,
            "clientCode": client_code,
            "jobId": job_id,
        }
    ).encode()
    result = agent_core_client.invoke_agent_runtime(
        agentRuntimeArn=AGENT_RUNTIME_ARN,
        runtimeSessionId=session_id,
        payload=payload,
        qualifier="DEFAULT",
    )
    chunks = list(result.get("response", []))
    raw_bytes = b"".join(chunks)
    try:
        agent_result = json.loads(raw_bytes.decode("utf-8"))
        return agent_result.get("result", "")
    except (UnicodeDecodeError, json.JSONDecodeError):
        text = raw_bytes.decode("utf-8", errors="replace")
        # エラー本文がJSON以外でそのまま返ってきた場合、一時的な障害なら呼び出し側で再試行できるよう例外にする。
        if TRANSIENT_ERROR_RE.search(text):
            raise RuntimeError(text)
        return text


def _parse_remaining(text):
    """報告末尾の `REMAINING: N` を返す。無い(他エージェント等)場合は0=再実行しない。"""
    matches = REMAINING_RE.findall(text or "")
    return int(matches[-1]) if matches else 0
