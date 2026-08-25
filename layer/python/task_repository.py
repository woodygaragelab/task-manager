"""
task_repository
================
DynamoDB(Tasks / TaskClients / TaskSeries / TaskFrames / TaskHistory)に対するCRUDロジックの共通モジュール。

taskmanager-mcp(FastMCP)と taskmanager-api(Web API用Lambda)の両方から
Lambda Layer として import される。ロジックの二重実装を避けるため、
MCPツールのデコレータや Web API のルーティングには一切依存しない
プレーンな関数のみをここに置く。

タスクは Client x Series x Frame の組み合わせを最小単位として持つ
(例: 「クライアントAの資料受領・2026年6月分」)。Series/Frameはクライアント
横断の共通マスタで、タスク作成時に未登録なら自動登録される。Clientのみ、
ドロップダウンからの明示的な新規登録操作があるため create_client を持つ。
"""

import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

import boto3
from boto3.dynamodb.conditions import Key

dynamodb = boto3.resource("dynamodb")
tasks_table = dynamodb.Table(os.environ["TASKS_TABLE"])
clients_table = dynamodb.Table(os.environ["CLIENTS_TABLE"])
series_table = dynamodb.Table(os.environ["SERIES_TABLE"])
frames_table = dynamodb.Table(os.environ["FRAMES_TABLE"])
history_table = dynamodb.Table(os.environ["HISTORY_TABLE"])
agent_jobs_table = dynamodb.Table(os.environ["AGENT_JOBS_TABLE"])
classification_rules_table = dynamodb.Table(os.environ["CLASSIFICATION_RULES_TABLE"])

CLIENT_BUCKET = "CLIENT"
SERIES_BUCKET = "SERIES"
FRAME_BUCKET = "FRAME"
AXIS_BUCKET = "AXIS"
RULE_BUCKET_PREFIX = "RULE#"
CLIENT_FIELD_LABEL_BUCKET = "CLIENT_FIELD_LABELS"
CLIENT_FIELD_LABEL_KEY = "LABELS"
TAB_COMMENT_BUCKET = "TAB_COMMENTS"
TAB_COMMENT_KEY = "COMMENTS"

# ClientConsolePage.jsxのタブ名(=ユーザー要望コメントを保存するキー)。
# クライアントごとではなくタブごとに1件、内容を問わない自由記述コメントを保持する。
TAB_KEYS = [
    "基本情報", "法人税", "源泉R8上期", "年調R7", "資料進捗", "履歴", "エージェント",
    "一覧:法人", "一覧:法人税", "一覧:源泉R8上期", "一覧:年調R7", "一覧:個人",
]

# 関与先プロフィール画面の汎用カスタム項目(col01-col40、すべて文字列)。
# 表示名は設定ページ(TaskClassificationRulesTableを流用したCLIENT_FIELD_LABELSバケット)で管理する。
CUSTOM_FIELD_CODES = [f"col{i:02d}" for i in range(1, 41)]


class TaskNotFoundError(Exception):
    """指定されたタスク(clientCode+seriesCode+frameCode)が存在しない場合に送出する。"""


class ClientAlreadyExistsError(Exception):
    """create_clientで既に登録済みのclientCodeを指定した場合に送出する。"""


class ClientNotFoundError(Exception):
    """update_clientで指定されたclientCodeが存在しない場合に送出する。"""


class SeriesAlreadyExistsError(Exception):
    """create_seriesで既に登録済みのseriesCodeを指定した場合に送出する。"""


class SeriesNotFoundError(Exception):
    """update_seriesで指定されたseriesCodeが存在しない場合に送出する。"""


class FrameAlreadyExistsError(Exception):
    """create_frameで既に登録済みのframeCodeを指定した場合に送出する。"""


class FrameNotFoundError(Exception):
    """update_frameで指定されたframeCodeが存在しない場合に送出する。"""


class HistoryEntryNotFoundError(Exception):
    """指定された履歴エントリ(clientCode+historyId)が存在しない場合に送出する。"""


class AgentJobNotFoundError(Exception):
    """指定されたエージェントジョブ(clientCode+jobId)が存在しない場合に送出する。"""


class ClassificationAxisAlreadyExistsError(Exception):
    """create_classification_axisで既に登録済みのaxisIdを指定した場合に送出する。"""


class ClassificationAxisNotFoundError(Exception):
    """指定された分類軸(axisId)が存在しない場合に送出する。"""


class ClassificationRuleNotFoundError(Exception):
    """指定された分類ルール(axisId+ruleId)が存在しない場合に送出する。"""


# ----------------------------------------------------------------------
# 内部ヘルパー
# ----------------------------------------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _task_key(series_code: str, frame_code: str) -> str:
    # SortKeyをこの連結文字列にすることで、GSIなしで「シリーズ内でフレーム順」の
    # 並びが手に入る(frameCodeがYYYYMM形式のため同一シリーズ内は時系列順)。
    return f"{series_code}#{frame_code}"


def _ensure_series_exists(series_code: str, series_name: str, task_group: str = "") -> None:
    """シリーズマスタに未登録ならPutする(冪等・競合安全)。"""
    try:
        series_table.put_item(
            Item={
                "lookupBucket": SERIES_BUCKET,
                "seriesCode": series_code,
                "seriesName": series_name,
                "taskGroup": task_group,
            },
            ConditionExpression="attribute_not_exists(seriesCode)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        pass  # 既に登録済み(同時実行時も含めて安全)


def _rule_bucket(axis_id: str) -> str:
    return f"{RULE_BUCKET_PREFIX}{axis_id}"


def _ensure_frame_exists(frame_code: str, frame_name: str) -> None:
    """フレームマスタに未登録ならPutする(冪等・競合安全)。"""
    try:
        frames_table.put_item(
            Item={
                "lookupBucket": FRAME_BUCKET,
                "frameCode": frame_code,
                "frameName": frame_name,
            },
            ConditionExpression="attribute_not_exists(frameCode)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        pass  # 既に登録済み(同時実行時も含めて安全)


# ----------------------------------------------------------------------
# 公開関数(MCPツール・Web APIハンドラ双方から呼ばれる)
# ----------------------------------------------------------------------
def list_clients() -> list[dict]:
    """登録済みの全クライアントを一覧取得する(クライアント選択ドロップダウン用)。"""
    resp = clients_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(CLIENT_BUCKET)
    )
    return resp.get("Items", [])


def create_client(
    client_code: str,
    client_name: str,
    receipt_folder_id: Optional[str] = None,
    renamed_folder_id: Optional[str] = None,
    assignee: Optional[str] = None,
    fiscal_year_end_month: Optional[str] = None,
    three_months_after_month: Optional[str] = None,
    interim_month: Optional[str] = None,
    nine_months_after_month: Optional[str] = None,
    sender_emails: Optional[list] = None,
    uketori_folder_id: Optional[str] = None,
    engagement_type: Optional[str] = None,
    payment_method: Optional[str] = None,
    col01: Optional[str] = None,
    col02: Optional[str] = None,
    col03: Optional[str] = None,
    col04: Optional[str] = None,
    col05: Optional[str] = None,
    col06: Optional[str] = None,
    col07: Optional[str] = None,
    col08: Optional[str] = None,
    col09: Optional[str] = None,
    col10: Optional[str] = None,
    col11: Optional[str] = None,
    col12: Optional[str] = None,
    col13: Optional[str] = None,
    col14: Optional[str] = None,
    col15: Optional[str] = None,
    col16: Optional[str] = None,
    col17: Optional[str] = None,
    col18: Optional[str] = None,
    col19: Optional[str] = None,
    col20: Optional[str] = None,
    col21: Optional[str] = None,
    col22: Optional[str] = None,
    col23: Optional[str] = None,
    col24: Optional[str] = None,
    col25: Optional[str] = None,
    col26: Optional[str] = None,
    col27: Optional[str] = None,
    col28: Optional[str] = None,
    col29: Optional[str] = None,
    col30: Optional[str] = None,
    col31: Optional[str] = None,
    col32: Optional[str] = None,
    col33: Optional[str] = None,
    col34: Optional[str] = None,
    col35: Optional[str] = None,
    col36: Optional[str] = None,
    col37: Optional[str] = None,
    col38: Optional[str] = None,
    col39: Optional[str] = None,
    col40: Optional[str] = None,
) -> dict:
    """クライアントを新規登録する(ドロップダウンの「新規作成」操作専用)。

    Series/Frameと異なりタスク作成に先立って単独で登録される操作のため、
    既に存在するclientCodeが指定された場合はConditionalCheckFailedExceptionを
    握りつぶさずClientAlreadyExistsErrorとして呼び出し元に伝える。

    receipt_folder_id/renamed_folder_idは「エージェント」タブの領収書整理エージェント
    (分類)が参照するGoogle DriveフォルダID。assignee(担当者)/fiscal_year_end_month
    (決算月)/three_months_after_month(3か月後月)/interim_month(中間月)/
    nine_months_after_month(9か月後月)/engagement_type(関与タイプ: 年一/自計化/
    反自計化)/payment_method(納付方式: ダイレクト/振替/納付書)はクライアントプロフィール
    画面で設定する属性。
    sender_emails/uketori_folder_idはメール要約エージェントが差出人メールアドレスから
    関与先を判定し、添付ファイルの保存先を決めるための属性。sender_emailsは1つの
    関与先に複数登録できる想定で、同じアドレスが別の関与先に登録されることは無い
    前提(重複チェックはアプリ側では行わない)。いずれも省略時は属性ごと書き込まない。

    col01-col40 は関与先プロフィール画面の汎用カスタム項目(すべて文字列、用途自由)。
    表示名は get_client_field_labels/update_client_field_labels で別管理する。
    """
    custom_fields = {code: locals()[code] for code in CUSTOM_FIELD_CODES}
    item = {
        "lookupBucket": CLIENT_BUCKET,
        "clientCode": client_code,
        "clientName": client_name,
    }
    if receipt_folder_id:
        item["receiptFolderId"] = receipt_folder_id
    if renamed_folder_id:
        item["renamedFolderId"] = renamed_folder_id
    if assignee:
        item["assignee"] = assignee
    if fiscal_year_end_month:
        item["fiscalYearEndMonth"] = fiscal_year_end_month
    if three_months_after_month:
        item["threeMonthsAfterMonth"] = three_months_after_month
    if interim_month:
        item["interimMonth"] = interim_month
    if nine_months_after_month:
        item["nineMonthsAfterMonth"] = nine_months_after_month
    if sender_emails:
        item["senderEmails"] = sender_emails
    if uketori_folder_id:
        item["uketoriFolderId"] = uketori_folder_id
    if engagement_type:
        item["engagementType"] = engagement_type
    if payment_method:
        item["paymentMethod"] = payment_method
    for code in CUSTOM_FIELD_CODES:
        value = custom_fields.get(code)
        if value:
            item[code] = value
    try:
        clients_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(clientCode)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        raise ClientAlreadyExistsError(f"clientCode {client_code} は既に登録されています")
    return item


def update_client(
    client_code: str,
    client_name: Optional[str] = None,
    receipt_folder_id: Optional[str] = None,
    renamed_folder_id: Optional[str] = None,
    assignee: Optional[str] = None,
    fiscal_year_end_month: Optional[str] = None,
    three_months_after_month: Optional[str] = None,
    interim_month: Optional[str] = None,
    nine_months_after_month: Optional[str] = None,
    sender_emails: Optional[list] = None,
    uketori_folder_id: Optional[str] = None,
    engagement_type: Optional[str] = None,
    payment_method: Optional[str] = None,
    col01: Optional[str] = None,
    col02: Optional[str] = None,
    col03: Optional[str] = None,
    col04: Optional[str] = None,
    col05: Optional[str] = None,
    col06: Optional[str] = None,
    col07: Optional[str] = None,
    col08: Optional[str] = None,
    col09: Optional[str] = None,
    col10: Optional[str] = None,
    col11: Optional[str] = None,
    col12: Optional[str] = None,
    col13: Optional[str] = None,
    col14: Optional[str] = None,
    col15: Optional[str] = None,
    col16: Optional[str] = None,
    col17: Optional[str] = None,
    col18: Optional[str] = None,
    col19: Optional[str] = None,
    col20: Optional[str] = None,
    col21: Optional[str] = None,
    col22: Optional[str] = None,
    col23: Optional[str] = None,
    col24: Optional[str] = None,
    col25: Optional[str] = None,
    col26: Optional[str] = None,
    col27: Optional[str] = None,
    col28: Optional[str] = None,
    col29: Optional[str] = None,
    col30: Optional[str] = None,
    col31: Optional[str] = None,
    col32: Optional[str] = None,
    col33: Optional[str] = None,
    col34: Optional[str] = None,
    col35: Optional[str] = None,
    col36: Optional[str] = None,
    col37: Optional[str] = None,
    col38: Optional[str] = None,
    col39: Optional[str] = None,
    col40: Optional[str] = None,
) -> dict:
    """既存クライアントのクライアント名・Driveフォルダ設定・担当者・決算月・3か月後月・中間月・9か月後月・差出人メールアドレス・受領フォルダ・関与タイプ・納付方式・col01-col40カスタム項目を更新する(指定した項目のみ変更)。"""
    custom_fields = {code: locals()[code] for code in CUSTOM_FIELD_CODES}

    key = {"lookupBucket": CLIENT_BUCKET, "clientCode": client_code}
    resp = clients_table.get_item(Key=key)
    if not resp.get("Item"):
        raise ClientNotFoundError(f"clientCode {client_code} が見つかりません")

    update_expr = []
    expr_values = {}

    if client_name is not None:
        update_expr.append("clientName = :n")
        expr_values[":n"] = client_name
    if receipt_folder_id is not None:
        update_expr.append("receiptFolderId = :rf")
        expr_values[":rf"] = receipt_folder_id
    if renamed_folder_id is not None:
        update_expr.append("renamedFolderId = :nf")
        expr_values[":nf"] = renamed_folder_id
    if assignee is not None:
        update_expr.append("assignee = :a")
        expr_values[":a"] = assignee
    if fiscal_year_end_month is not None:
        update_expr.append("fiscalYearEndMonth = :fy")
        expr_values[":fy"] = fiscal_year_end_month
    if three_months_after_month is not None:
        update_expr.append("threeMonthsAfterMonth = :m3")
        expr_values[":m3"] = three_months_after_month
    if interim_month is not None:
        update_expr.append("interimMonth = :im")
        expr_values[":im"] = interim_month
    if nine_months_after_month is not None:
        update_expr.append("nineMonthsAfterMonth = :m9")
        expr_values[":m9"] = nine_months_after_month
    if sender_emails is not None:
        update_expr.append("senderEmails = :se")
        expr_values[":se"] = sender_emails
    if uketori_folder_id is not None:
        update_expr.append("uketoriFolderId = :uf")
        expr_values[":uf"] = uketori_folder_id
    if engagement_type is not None:
        update_expr.append("engagementType = :et")
        expr_values[":et"] = engagement_type
    if payment_method is not None:
        update_expr.append("paymentMethod = :pm")
        expr_values[":pm"] = payment_method
    for code in CUSTOM_FIELD_CODES:
        if code in custom_fields and custom_fields[code] is not None:
            placeholder = f":{code}"
            update_expr.append(f"{code} = {placeholder}")
            expr_values[placeholder] = custom_fields[code]

    if not update_expr:
        return resp["Item"]

    resp = clients_table.update_item(
        Key=key,
        UpdateExpression="SET " + ", ".join(update_expr),
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def get_client_field_labels() -> dict:
    """関与先プロフィール画面のcol01-col40カスタム項目に設定された表示名を取得する(未設定の項目は空文字)。"""
    resp = classification_rules_table.get_item(
        Key={"lookupBucket": CLIENT_FIELD_LABEL_BUCKET, "sortKey": CLIENT_FIELD_LABEL_KEY}
    )
    item = resp.get("Item") or {}
    return {code: item.get(code, "") for code in CUSTOM_FIELD_CODES}


def update_client_field_labels(labels: dict) -> dict:
    """col01-col40カスタム項目の表示名を更新する(設定ページ専用、指定されたキーのみ変更)。"""
    unknown_fields = set(labels) - set(CUSTOM_FIELD_CODES)
    if unknown_fields:
        raise ValueError(f"不明なカスタム項目です: {sorted(unknown_fields)}")

    update_expr = []
    expr_values = {}
    for code in CUSTOM_FIELD_CODES:
        if code in labels:
            placeholder = f":{code}"
            update_expr.append(f"{code} = {placeholder}")
            expr_values[placeholder] = labels[code] or ""

    if update_expr:
        classification_rules_table.update_item(
            Key={"lookupBucket": CLIENT_FIELD_LABEL_BUCKET, "sortKey": CLIENT_FIELD_LABEL_KEY},
            UpdateExpression="SET " + ", ".join(update_expr),
            ExpressionAttributeValues=expr_values,
        )
    return get_client_field_labels()


def get_tab_comments() -> dict:
    """関与先コンソール画面の各タブに設定されたユーザー要望コメントを取得する(未設定のタブは空文字)。

    クライアントコードに依らない、タブ単位で1つだけ共有されるコメントである点に注意。
    """
    resp = classification_rules_table.get_item(
        Key={"lookupBucket": TAB_COMMENT_BUCKET, "sortKey": TAB_COMMENT_KEY}
    )
    item = resp.get("Item") or {}
    return {tab: item.get(tab, "") for tab in TAB_KEYS}


def update_tab_comment(tab_key: str, comment: str) -> dict:
    """指定タブのユーザー要望コメントを更新する(関与先コンソール画面の各タブ最下部の入力欄用)。"""
    if tab_key not in TAB_KEYS:
        raise ValueError(f"不明なタブです: {tab_key}")
    classification_rules_table.update_item(
        Key={"lookupBucket": TAB_COMMENT_BUCKET, "sortKey": TAB_COMMENT_KEY},
        UpdateExpression="SET #t = :c",
        ExpressionAttributeNames={"#t": tab_key},
        ExpressionAttributeValues={":c": comment or ""},
    )
    return get_tab_comments()


def delete_client(client_code: str) -> None:
    """クライアントマスタから削除する(クライアント一覧画面の削除操作用)。"""
    clients_table.delete_item(Key={"lookupBucket": CLIENT_BUCKET, "clientCode": client_code})


def list_series() -> list[dict]:
    """登録済みの全シリーズを一覧取得する(タスク作成時のドロップダウン用)。"""
    resp = series_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(SERIES_BUCKET)
    )
    return resp.get("Items", [])


def create_series(series_code: str, series_name: str, task_group: str = "") -> dict:
    """シリーズを新規登録する(タスクシリーズ一覧画面の「新規作成」操作専用)。

    create_task経由の自動登録(_ensure_series_exists)とは異なり、既に存在する
    seriesCodeが指定された場合はSeriesAlreadyExistsErrorを送出する。
    """
    item = {
        "lookupBucket": SERIES_BUCKET,
        "seriesCode": series_code,
        "seriesName": series_name,
        "taskGroup": task_group,
    }
    try:
        series_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(seriesCode)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        raise SeriesAlreadyExistsError(f"seriesCode {series_code} は既に登録されています")
    return item


def update_series(
    series_code: str,
    series_name: Optional[str] = None,
    task_group: Optional[str] = None,
) -> dict:
    """既存シリーズのシリーズ名・分類(taskGroup)を更新する(指定した項目のみ変更)。"""
    key = {"lookupBucket": SERIES_BUCKET, "seriesCode": series_code}
    resp = series_table.get_item(Key=key)
    if not resp.get("Item"):
        raise SeriesNotFoundError(f"seriesCode {series_code} が見つかりません")

    update_expr = []
    expr_values = {}

    if series_name is not None:
        update_expr.append("seriesName = :n")
        expr_values[":n"] = series_name
    if task_group is not None:
        update_expr.append("taskGroup = :tg")
        expr_values[":tg"] = task_group

    if not update_expr:
        return resp["Item"]

    resp = series_table.update_item(
        Key=key,
        UpdateExpression="SET " + ", ".join(update_expr),
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def delete_series(series_code: str) -> None:
    """シリーズマスタから削除する(タスクシリーズ一覧画面の削除操作用)。"""
    series_table.delete_item(Key={"lookupBucket": SERIES_BUCKET, "seriesCode": series_code})


def list_frames() -> list[dict]:
    """登録済みの全フレームを一覧取得する(タスク作成時のドロップダウン用)。"""
    resp = frames_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(FRAME_BUCKET)
    )
    return resp.get("Items", [])


def create_frame(frame_code: str, frame_name: str) -> dict:
    """フレームを新規登録する(フレーム一覧画面の「新規作成」操作専用)。

    create_task経由の自動登録(_ensure_frame_exists)とは異なり、既に存在する
    frameCodeが指定された場合はFrameAlreadyExistsErrorを送出する。
    """
    item = {
        "lookupBucket": FRAME_BUCKET,
        "frameCode": frame_code,
        "frameName": frame_name,
    }
    try:
        frames_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(frameCode)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        raise FrameAlreadyExistsError(f"frameCode {frame_code} は既に登録されています")
    return item


def update_frame(frame_code: str, frame_name: Optional[str] = None) -> dict:
    """既存フレームのフレーム名を更新する(指定した項目のみ変更)。"""
    key = {"lookupBucket": FRAME_BUCKET, "frameCode": frame_code}
    resp = frames_table.get_item(Key=key)
    if not resp.get("Item"):
        raise FrameNotFoundError(f"frameCode {frame_code} が見つかりません")

    update_expr = []
    expr_values = {}

    if frame_name is not None:
        update_expr.append("frameName = :n")
        expr_values[":n"] = frame_name

    if not update_expr:
        return resp["Item"]

    resp = frames_table.update_item(
        Key=key,
        UpdateExpression="SET " + ", ".join(update_expr),
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def delete_frame(frame_code: str) -> None:
    """フレームマスタから削除する(フレーム一覧画面の削除操作用)。"""
    frames_table.delete_item(Key={"lookupBucket": FRAME_BUCKET, "frameCode": frame_code})


DEFAULT_FRAME_RANGE_PATTERN = r"(\d{1,2})(?:\s*[-〜~]\s*(\d{1,2}))?\s*月"


def extract_frame_codes(text: str, year: str, pattern: str = DEFAULT_FRAME_RANGE_PATTERN) -> list[str]:
    """自由記述のテキストから「1-9月」「6月」のような対象月表記を読み取り、frameCode(YYYYMM)のリストに変換する。

    デフォルトのpatternは、グループ1=開始月・グループ2=終了月(範囲表記でなければ省略可)を
    捉える正規表現(「1-9月」「1〜9月」のような範囲、「6月」のような単月の両方にマッチ)。
    「1月分」等、別の表記ルールに対応したい場合はpatternを差し替えられる(グループ構成は
    デフォルトと同じ規約に従うこと)。
    """
    months: set[int] = set()
    for m in re.finditer(pattern, text):
        start = int(m.group(1))
        end_str = m.group(2) if m.re.groups >= 2 else None
        end = int(end_str) if end_str else start
        if end < start:
            start, end = end, start
        for month in range(start, end + 1):
            if 1 <= month <= 12:
                months.add(month)
    return [f"{year}{month:02d}" for month in sorted(months)]


def create_task(
    client_code: str,
    series_code: str,
    series_name: str,
    frame_code: str,
    frame_name: str,
    status: str = "未着手",
    assignee: str = "",
    complete_date: Optional[str] = None,
    task_group: str = "",
) -> dict:
    """新しいタスクを作成する。

    series_code/frame_codeが未登録の場合はそれぞれのマスタに自動登録される。
    task_groupはシリーズマスタの属性(表示名: 分類)であり、シリーズが新規登録される
    場合のみ使われる(既存シリーズの場合は_ensure_series_existsが何もしないため無視される)。
    client_codeは自動登録しない(Clientのみ事前にcreate_client()で登録済みであることを前提とする。
    Series/Frameと異なりドロップダウンでの明示的な新規登録操作を持つため)。
    既に同じclientCode+seriesCode+frameCodeのタスクが存在する場合は単純に上書きする。
    """
    now = _now()
    item = {
        "clientCode": client_code,
        "taskKey": _task_key(series_code, frame_code),
        "seriesCode": series_code,
        "frameCode": frame_code,
        "status": status,
        "assignee": assignee,
        "completeDate": complete_date,
        "createdAt": now,
        "updatedAt": now,
    }
    tasks_table.put_item(Item=item)
    _ensure_series_exists(series_code, series_name, task_group)
    _ensure_frame_exists(frame_code, frame_name)
    return item


def get_task(client_code: str, series_code: str, frame_code: str) -> dict:
    """clientCode/seriesCode/frameCodeを指定してタスクを1件取得する。"""
    resp = tasks_table.get_item(
        Key={"clientCode": client_code, "taskKey": _task_key(series_code, frame_code)}
    )
    item = resp.get("Item")
    if not item:
        raise TaskNotFoundError(
            f"タスク(clientCode={client_code}, seriesCode={series_code}, frameCode={frame_code}) が見つかりません"
        )
    return item


def update_task(
    client_code: str,
    series_code: str,
    frame_code: str,
    status: Optional[str] = None,
    assignee: Optional[str] = None,
    complete_date: Optional[str] = None,
) -> dict:
    """既存タスクのステータス・担当者・完了日を更新する(指定した項目のみ変更)。"""
    key = {"clientCode": client_code, "taskKey": _task_key(series_code, frame_code)}
    resp = tasks_table.get_item(Key=key)
    if not resp.get("Item"):
        raise TaskNotFoundError(
            f"タスク(clientCode={client_code}, seriesCode={series_code}, frameCode={frame_code}) が見つかりません"
        )

    update_expr = ["#u = :now"]
    expr_names = {"#u": "updatedAt"}
    expr_values = {":now": _now()}

    if status is not None:
        update_expr.append("#s = :s")
        expr_names["#s"] = "status"
        expr_values[":s"] = status
    if assignee is not None:
        update_expr.append("assignee = :a")
        expr_values[":a"] = assignee
    if complete_date is not None:
        update_expr.append("completeDate = :cd")
        expr_values[":cd"] = complete_date

    resp = tasks_table.update_item(
        Key=key,
        UpdateExpression="SET " + ", ".join(update_expr),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def delete_task(client_code: str, series_code: str, frame_code: str) -> None:
    """タスクを1件削除する。"""
    tasks_table.delete_item(
        Key={"clientCode": client_code, "taskKey": _task_key(series_code, frame_code)}
    )


def list_tasks_by_client(client_code: str) -> list[dict]:
    """指定したクライアントコード(完全一致)のタスクを、シリーズ内でフレーム順に一覧取得する。"""
    resp = tasks_table.query(KeyConditionExpression=Key("clientCode").eq(client_code))
    return resp.get("Items", [])


def list_history(client_code: str) -> list[dict]:
    """指定クライアントの履歴エントリを一覧取得する(分類昇順、同一分類内は日付昇順)。"""
    resp = history_table.query(KeyConditionExpression=Key("clientCode").eq(client_code))
    items = resp.get("Items", [])
    items.sort(key=lambda i: (i.get("category") or "", i.get("date") or "", i.get("createdAt") or ""))
    return items


def create_history_entry(
    client_code: str,
    date: str,
    category: str = "",
    series_code: str = "",
    frame_codes: Optional[list[str]] = None,
    assignee: str = "",
    status: str = "",
    content: str = "",
    classifications: Optional[dict] = None,
) -> dict:
    """クライアントの履歴エントリを1件追加する(日付・分類・タスク名(Series)・対象月(Frameのリスト)・担当者・ステータス・内容を持つ)。

    classificationsは軸ID→分類名のマップ(分類機能の判定結果、任意)。既存のcategory
    (taskGroupセレクトの値)とは独立した属性で、`POST /classify`の判定結果をそのまま
    保存する用途を想定する。
    """
    now = _now()
    item = {
        "clientCode": client_code,
        "historyId": str(uuid.uuid4()),
        "date": date,
        "category": category,
        "seriesCode": series_code,
        "frameCodes": frame_codes or [],
        "assignee": assignee,
        "status": status,
        "content": content,
        "classifications": classifications or {},
        "createdAt": now,
        "updatedAt": now,
    }
    history_table.put_item(Item=item)
    return item


def update_history_entry(
    client_code: str,
    history_id: str,
    date: Optional[str] = None,
    category: Optional[str] = None,
    series_code: Optional[str] = None,
    frame_codes: Optional[list[str]] = None,
    assignee: Optional[str] = None,
    status: Optional[str] = None,
    content: Optional[str] = None,
    classifications: Optional[dict] = None,
) -> dict:
    """既存の履歴エントリを更新する(指定した項目のみ変更)。"""
    key = {"clientCode": client_code, "historyId": history_id}
    resp = history_table.get_item(Key=key)
    if not resp.get("Item"):
        raise HistoryEntryNotFoundError(
            f"履歴エントリ(clientCode={client_code}, historyId={history_id}) が見つかりません"
        )

    update_expr = ["#u = :now"]
    expr_names = {"#u": "updatedAt"}
    expr_values = {":now": _now()}

    if date is not None:
        update_expr.append("#d = :date")
        expr_names["#d"] = "date"
        expr_values[":date"] = date
    if category is not None:
        update_expr.append("category = :category")
        expr_values[":category"] = category
    if series_code is not None:
        update_expr.append("seriesCode = :seriesCode")
        expr_values[":seriesCode"] = series_code
    if frame_codes is not None:
        update_expr.append("frameCodes = :frameCodes")
        expr_values[":frameCodes"] = frame_codes
    if assignee is not None:
        update_expr.append("assignee = :assignee")
        expr_values[":assignee"] = assignee
    if status is not None:
        update_expr.append("#s = :status")
        expr_names["#s"] = "status"
        expr_values[":status"] = status
    if content is not None:
        update_expr.append("content = :content")
        expr_values[":content"] = content
    if classifications is not None:
        update_expr.append("classifications = :classifications")
        expr_values[":classifications"] = classifications

    resp = history_table.update_item(
        Key=key,
        UpdateExpression="SET " + ", ".join(update_expr),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def delete_history_entry(client_code: str, history_id: str) -> None:
    """履歴エントリを削除する。"""
    history_table.delete_item(Key={"clientCode": client_code, "historyId": history_id})


# ----------------------------------------------------------------------
# 分類機能(履歴のcontentをキーワード/正規表現ルールで自動分類する)
#
# TaskClassificationRulesテーブル1つに、lookupBucketの値で「軸(AXIS)」定義と
# 「ルール(RULE#<axisId>)」を同居させる単一テーブル設計。Series/Frameマスタと
# 同じlookupBucketによるバケット分割パターンを踏襲し、軸をいくつ追加しても
# テーブル追加やデプロイを不要にしている(詳細は設計書4-7節・9-13節)。
# ----------------------------------------------------------------------
def list_classification_axes() -> list[dict]:
    """登録済みの全分類軸を一覧取得する(「分類ルール」ページの軸タブ、classify()の判定対象)。"""
    resp = classification_rules_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(AXIS_BUCKET)
    )
    return resp.get("Items", [])


def create_classification_axis(axis_id: str, label: str) -> dict:
    """分類軸を新規登録する(「分類ルール」ページの「+ 軸を追加」操作専用)。"""
    item = {
        "lookupBucket": AXIS_BUCKET,
        "sortKey": axis_id,
        "axisId": axis_id,
        "label": label,
    }
    try:
        classification_rules_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(sortKey)",
        )
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        raise ClassificationAxisAlreadyExistsError(f"axisId {axis_id} は既に登録されています")
    return item


def update_classification_axis(axis_id: str, label: Optional[str] = None) -> dict:
    """分類軸の表示名(label)を更新する(指定した項目のみ変更)。"""
    key = {"lookupBucket": AXIS_BUCKET, "sortKey": axis_id}
    resp = classification_rules_table.get_item(Key=key)
    if not resp.get("Item"):
        raise ClassificationAxisNotFoundError(f"axisId {axis_id} が見つかりません")

    if label is None:
        return resp["Item"]

    resp = classification_rules_table.update_item(
        Key=key,
        UpdateExpression="SET label = :l",
        ExpressionAttributeValues={":l": label},
        ReturnValues="ALL_NEW",
    )
    return resp["Attributes"]


def delete_classification_axis(axis_id: str) -> None:
    """分類軸を削除する(配下のルールも全てカスケード削除する)。"""
    for rule in list_classification_rules(axis_id):
        classification_rules_table.delete_item(
            Key={"lookupBucket": _rule_bucket(axis_id), "sortKey": rule["ruleId"]}
        )
    classification_rules_table.delete_item(Key={"lookupBucket": AXIS_BUCKET, "sortKey": axis_id})


def list_classification_rules(axis_id: str) -> list[dict]:
    """指定した軸に属するルールを、priority昇順(値が小さいほど優先評価)で一覧取得する。"""
    resp = classification_rules_table.query(
        KeyConditionExpression=Key("lookupBucket").eq(_rule_bucket(axis_id))
    )
    items = resp.get("Items", [])
    items.sort(key=lambda i: (i.get("priority", 0), i.get("ruleId", "")))
    return items


def create_classification_rule(
    axis_id: str,
    category: str,
    pattern: str,
    match_type: str = "keyword",
    priority: int = 0,
) -> dict:
    """軸配下にルールを1件追加する。matchTypeは"keyword"(部分一致)または"regex"(正規表現)。"""
    if match_type not in ("keyword", "regex"):
        raise ValueError('matchType は "keyword" または "regex" である必要があります')
    axis_resp = classification_rules_table.get_item(
        Key={"lookupBucket": AXIS_BUCKET, "sortKey": axis_id}
    )
    if not axis_resp.get("Item"):
        raise ClassificationAxisNotFoundError(f"axisId {axis_id} が見つかりません")

    rule_id = str(uuid.uuid4())
    item = {
        "lookupBucket": _rule_bucket(axis_id),
        "sortKey": rule_id,
        "ruleId": rule_id,
        "axisId": axis_id,
        "category": category,
        "pattern": pattern,
        "matchType": match_type,
        "priority": priority,
    }
    classification_rules_table.put_item(Item=item)
    return item


def update_classification_rule(
    axis_id: str,
    rule_id: str,
    category: Optional[str] = None,
    pattern: Optional[str] = None,
    match_type: Optional[str] = None,
    priority: Optional[int] = None,
) -> dict:
    """既存ルールを更新する(指定した項目のみ変更)。"""
    if match_type is not None and match_type not in ("keyword", "regex"):
        raise ValueError('matchType は "keyword" または "regex" である必要があります')

    key = {"lookupBucket": _rule_bucket(axis_id), "sortKey": rule_id}
    resp = classification_rules_table.get_item(Key=key)
    if not resp.get("Item"):
        raise ClassificationRuleNotFoundError(
            f"ルール(axisId={axis_id}, ruleId={rule_id}) が見つかりません"
        )

    update_expr = []
    expr_names = {}
    expr_values = {}
    if category is not None:
        update_expr.append("category = :c")
        expr_values[":c"] = category
    if pattern is not None:
        update_expr.append("#p = :p")
        expr_names["#p"] = "pattern"
        expr_values[":p"] = pattern
    if match_type is not None:
        update_expr.append("matchType = :mt")
        expr_values[":mt"] = match_type
    if priority is not None:
        update_expr.append("priority = :pr")
        expr_values[":pr"] = priority

    if not update_expr:
        return resp["Item"]

    kwargs = {
        "Key": key,
        "UpdateExpression": "SET " + ", ".join(update_expr),
        "ExpressionAttributeValues": expr_values,
        "ReturnValues": "ALL_NEW",
    }
    if expr_names:
        kwargs["ExpressionAttributeNames"] = expr_names
    resp = classification_rules_table.update_item(**kwargs)
    return resp["Attributes"]


def delete_classification_rule(axis_id: str, rule_id: str) -> None:
    """ルールを削除する。"""
    classification_rules_table.delete_item(
        Key={"lookupBucket": _rule_bucket(axis_id), "sortKey": rule_id}
    )


def _rule_matches(rule: dict, text: str) -> bool:
    pattern = rule.get("pattern", "")
    if rule.get("matchType") == "regex":
        try:
            return re.search(pattern, text) is not None
        except re.error:
            return False  # 不正な正規表現は「不一致」として扱う(他ルール・他軸の判定を止めない)
    return pattern in text


def classify(text: str) -> list[dict]:
    """登録済み全軸をまとめて判定する(履歴パネルの「自動判定」ボタン、`POST /classify`用)。

    軸ごとに、登録済みルールをpriority昇順で評価し、最初に一致したルールのcategoryを
    採用する。軸同士は完全に独立しており、ある軸の判定が他の軸に影響しない。どのルール
    にも一致しない軸はcategory=None(未判定)として結果に含める(軸自体は常に返すことで、
    呼び出し側が「軸の数だけ動的に入力欄を表示する」動作を実装できるようにするため)。
    """
    results = []
    for axis in list_classification_axes():
        matched = None
        for rule in list_classification_rules(axis["axisId"]):
            if _rule_matches(rule, text):
                matched = rule
                break
        results.append(
            {
                "axisId": axis["axisId"],
                "label": axis.get("label", ""),
                "category": matched["category"] if matched else None,
                "matchedRuleId": matched["ruleId"] if matched else None,
                "matchedPattern": matched["pattern"] if matched else None,
            }
        )
    return results


# ----------------------------------------------------------------------
# エージェントジョブ(「エージェント」タブの非同期ディスパッチ処理)
# ----------------------------------------------------------------------
AGENT_JOB_TTL_SECONDS = 60 * 60 * 24  # 1日後に自動削除


def create_agent_job(client_code: str, agent_id: str, prompt: str) -> dict:
    """エージェントへの指示を1件登録する(status="processing"で作成、実行はLambda側が非同期に行う)。"""
    now = _now()
    item = {
        "clientCode": client_code,
        "jobId": str(uuid.uuid4()),
        "agentId": agent_id,
        "status": "processing",
        "prompt": prompt,
        "createdAt": now,
        "updatedAt": now,
        "ttl": int(datetime.now(timezone.utc).timestamp()) + AGENT_JOB_TTL_SECONDS,
    }
    agent_jobs_table.put_item(Item=item)
    return item


def list_agent_jobs(client_code: str, agent_id: Optional[str] = None) -> list[dict]:
    """指定クライアントのエージェントジョブを新しい順に一覧取得する(「エージェント」タブの前回実行結果表示用)。

    agent_idを指定した場合はそのエージェントのジョブのみに絞り込む(jobIdはUUIDでソート
    キーとして時系列順にならないため、createdAtで都度ソートする)。
    """
    resp = agent_jobs_table.query(KeyConditionExpression=Key("clientCode").eq(client_code))
    items = resp.get("Items", [])
    if agent_id:
        items = [i for i in items if i.get("agentId") == agent_id]
    items.sort(key=lambda i: i.get("createdAt") or "", reverse=True)
    return items


def get_agent_job(client_code: str, job_id: str) -> dict:
    """エージェントジョブを1件取得する(ポーリング用)。"""
    resp = agent_jobs_table.get_item(Key={"clientCode": client_code, "jobId": job_id})
    item = resp.get("Item")
    if not item:
        raise AgentJobNotFoundError(
            f"エージェントジョブ(clientCode={client_code}, jobId={job_id}) が見つかりません"
        )
    return item


def claim_agent_job(client_code: str, job_id: str) -> bool:
    """ジョブを処理対象としてclaimする(Lambdaの非同期呼び出し再試行による二重実行防止)。

    既にclaim済みなら何もせずFalseを返す(呼び出し元はそこで処理を打ち切る)。
    """
    try:
        agent_jobs_table.update_item(
            Key={"clientCode": client_code, "jobId": job_id},
            UpdateExpression="SET claimedAt = :now",
            ConditionExpression="attribute_not_exists(claimedAt)",
            ExpressionAttributeValues={":now": _now()},
        )
        return True
    except dynamodb.meta.client.exceptions.ConditionalCheckFailedException:
        return False


def complete_agent_job(client_code: str, job_id: str, result: str) -> None:
    """ジョブの実行結果を記録し、完了状態にする。"""
    agent_jobs_table.update_item(
        Key={"clientCode": client_code, "jobId": job_id},
        UpdateExpression="SET #s = :status, #r = :result, updatedAt = :now",
        ExpressionAttributeNames={"#s": "status", "#r": "result"},
        ExpressionAttributeValues={
            ":status": "completed",
            ":result": result,
            ":now": _now(),
        },
    )


def fail_agent_job(client_code: str, job_id: str, error: str) -> None:
    """ジョブの失敗を記録する。"""
    agent_jobs_table.update_item(
        Key={"clientCode": client_code, "jobId": job_id},
        UpdateExpression="SET #s = :status, #e = :error, updatedAt = :now",
        ExpressionAttributeNames={"#s": "status", "#e": "error"},
        ExpressionAttributeValues={
            ":status": "error",
            ":error": error,
            ":now": _now(),
        },
    )
