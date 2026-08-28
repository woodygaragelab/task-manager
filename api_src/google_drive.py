"""
Google Driveのフォルダ作成のみを行う薄いラッパー。

task-agent(Bedrock AgentCore側)が使っているのと同じユーザーOAuthリフレッシュ
トークン(Secrets Manager: task-agent/google-drive-user-token)を再利用する。
このLambda(taskmanager-api)にはgoogleapiclientが同梱されていないため、
標準ライブラリのurllibでOAuthトークンのリフレッシュとDrive REST API v3を
直接呼び出す(依存追加・Lambdaレイヤー変更を避けるため)。
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

import boto3

AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
GOOGLE_USER_TOKEN_SECRET_NAME = os.environ.get(
    "GOOGLE_USER_TOKEN_SECRET_NAME", "task-agent/google-drive-user-token"
)
DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"

_secrets_client = boto3.client("secretsmanager", region_name=AWS_REGION)
_token_info_cache = None


def _get_token_info() -> dict:
    global _token_info_cache
    if _token_info_cache is None:
        secret = _secrets_client.get_secret_value(SecretId=GOOGLE_USER_TOKEN_SECRET_NAME)
        _token_info_cache = json.loads(secret["SecretString"])
    return _token_info_cache


def _get_access_token() -> str:
    info = _get_token_info()
    data = urllib.parse.urlencode(
        {
            "client_id": info["client_id"],
            "client_secret": info["client_secret"],
            "refresh_token": info["refresh_token"],
            "grant_type": "refresh_token",
        }
    ).encode()
    req = urllib.request.Request(
        info.get("token_uri", "https://oauth2.googleapis.com/token"), data=data
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["access_token"]


def _drive_request(method: str, access_token: str, query: dict = None, body: dict = None) -> dict:
    url = DRIVE_FILES_URL
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {access_token}")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")
        raise RuntimeError(f"Google Drive APIエラー({e.code}): {detail}") from e


def find_folder(name: str, parent_id: str) -> dict | None:
    """parent_id直下にある、同名・未trashのフォルダを1件探す(無ければNone)。"""
    access_token = _get_access_token()
    escaped_name = name.replace("\\", "\\\\").replace("'", "\\'")
    query_string = (
        f"name = '{escaped_name}' and '{parent_id}' in parents "
        "and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    )
    result = _drive_request(
        "GET",
        access_token,
        query={"q": query_string, "fields": "files(id,name,webViewLink)"},
    )
    files = result.get("files", [])
    return files[0] if files else None


def create_folder(name: str, parent_id: str) -> dict:
    """parent_id直下にname(フォルダ名)のフォルダを作成する。

    同名フォルダが既に存在する場合は新規作成せずそれを返す(繰り返し呼んでも
    フォルダが増殖しないようにするための冪等化)。
    """
    existing = find_folder(name, parent_id)
    if existing:
        return existing
    access_token = _get_access_token()
    body = {
        "name": name,
        "mimeType": "application/vnd.google-apps.folder",
        "parents": [parent_id],
    }
    return _drive_request(
        "POST", access_token, query={"fields": "id,name,webViewLink"}, body=body
    )
