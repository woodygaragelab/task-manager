"""
Google Driveのフォルダ作成・テンプレート複製(フォルダ+ファイル)を行う薄いラッパー。

task-agent(Bedrock AgentCore側)が使っているのと同じユーザーOAuthリフレッシュ
トークン(Secrets Manager: task-agent/google-drive-user-token)を再利用する。
このLambda(taskmanager-api)にはgoogleapiclientが同梱されていないため、
標準ライブラリのurllibでOAuthトークンのリフレッシュとDrive REST API v3を
直接呼び出す(依存追加・Lambdaレイヤー変更を避けるため)。
"""

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import boto3

AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
GOOGLE_USER_TOKEN_SECRET_NAME = os.environ.get(
    "GOOGLE_USER_TOKEN_SECRET_NAME", "task-agent/google-drive-user-token"
)
DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files"
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

_secrets_client = boto3.client("secretsmanager", region_name=AWS_REGION)
_token_info_cache = None
_access_token_cache = None  # {"token": str, "expires_at": time.monotonic()の値}


def _get_token_info() -> dict:
    global _token_info_cache
    if _token_info_cache is None:
        secret = _secrets_client.get_secret_value(SecretId=GOOGLE_USER_TOKEN_SECRET_NAME)
        _token_info_cache = json.loads(secret["SecretString"])
    return _token_info_cache


def _get_access_token() -> str:
    """アクセストークンをLambda実行環境内でキャッシュし、期限が切れるまで使い回す。
    キャッシュしないとDrive APIを呼ぶたびにOAuthトークンのリフレッシュが発生し、
    フォルダ構成の複製(項目数ぶんDrive APIを呼ぶ)で往復回数が倍増し、API Gateway
    (HTTP API)の30秒タイムアウトに達しやすくなるため。"""
    global _access_token_cache
    now = time.monotonic()
    if _access_token_cache and _access_token_cache["expires_at"] > now:
        return _access_token_cache["token"]

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
        token_response = json.loads(resp.read())
    expires_in = token_response.get("expires_in", 3600)
    _access_token_cache = {
        "token": token_response["access_token"],
        "expires_at": now + expires_in - 60,  # 期限ぎりぎりでの失効を避けるバッファ
    }
    return _access_token_cache["token"]


def _drive_request(
    method: str, access_token: str, query: dict = None, body: dict = None, url: str = DRIVE_FILES_URL
) -> dict:
    # 共有ドライブ(Shared Drive)配下のフォルダ・ファイルも扱えるようにする
    # (無いとマイドライブ上のIDしか見えず、共有ドライブ上のIDは404 File not foundになる)。
    query = {**(query or {}), "supportsAllDrives": "true"}
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


def _find_child(name: str, parent_id: str, mime_type: str = None) -> dict | None:
    """parent_id直下にある、同名・未trashの子(フォルダ/ファイル)を1件探す(無ければNone)。"""
    access_token = _get_access_token()
    escaped_name = name.replace("\\", "\\\\").replace("'", "\\'")
    clauses = [f"name = '{escaped_name}'", f"'{parent_id}' in parents", "trashed = false"]
    if mime_type:
        clauses.append(f"mimeType = '{mime_type}'")
    result = _drive_request(
        "GET",
        access_token,
        query={
            "q": " and ".join(clauses),
            "fields": "files(id,name,webViewLink)",
            "includeItemsFromAllDrives": "true",
        },
    )
    files = result.get("files", [])
    return files[0] if files else None


def find_folder(name: str, parent_id: str) -> dict | None:
    """parent_id直下にある、同名・未trashのフォルダを1件探す(無ければNone)。"""
    return _find_child(name, parent_id, mime_type=FOLDER_MIME_TYPE)


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
        "mimeType": FOLDER_MIME_TYPE,
        "parents": [parent_id],
    }
    return _drive_request(
        "POST", access_token, query={"fields": "id,name,webViewLink"}, body=body
    )


def list_children(parent_id: str) -> list:
    """parent_id直下の子(フォルダ・ファイル問わず)一覧(id, name, mimeType)を返す。"""
    access_token = _get_access_token()
    query_string = f"'{parent_id}' in parents and trashed = false"
    result = _drive_request(
        "GET",
        access_token,
        query={
            "q": query_string,
            "fields": "files(id,name,mimeType)",
            "includeItemsFromAllDrives": "true",
        },
    )
    return result.get("files", [])


def copy_file(source_file_id: str, name: str, dest_parent_id: str) -> dict:
    """source_file_idのファイルをdest_parent_id直下へname名でコピーする。

    同名ファイルが既にdest_parent_id直下にあればコピーせずそれを返す(冪等化)。
    """
    existing = _find_child(name, dest_parent_id)
    if existing:
        return existing
    access_token = _get_access_token()
    body = {"name": name, "parents": [dest_parent_id]}
    return _drive_request(
        "POST",
        access_token,
        query={"fields": "id,name,webViewLink"},
        body=body,
        url=f"{DRIVE_FILES_URL}/{source_file_id}/copy",
    )


def replicate_folder_structure(
    source_parent_id: str, dest_parent_id: str, concurrency: int = 8
) -> None:
    """source_parent_id直下の構成(フォルダ・ファイル)をdest_parent_id直下に再帰的に
    複製する(フォルダは再帰、ファイルはコピー)。

    テンプレートフォルダの中身を都度参照するため、テンプレート側に追加・変更すれば
    次回の複製にそのまま反映される(構成をコード側に固定しない)。既に同名の子が
    ある場合は作り直し/コピーし直しをせずそれを使うので、繰り返し呼んでも安全(冪等)。

    このAPIはAPI Gateway(HTTP API)の30秒タイムアウト内で完了する必要があるため、
    同じ階層内の項目(フォルダ作成・ファイルコピー)はスレッドプールで並列に処理する
    (階層ごとにまとめて処理してから次の階層へ進むBFS方式。深い再帰を1スレッドが
    待ち続ける実装だとスレッドプールが枯渇しうるため、あえてこの形にしている)。
    """
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        level = [(source_parent_id, dest_parent_id)]
        while level:
            list_futures = {pool.submit(list_children, src): dest for src, dest in level}
            create_futures = {}
            copy_futures = []
            for future in as_completed(list_futures):
                dest = list_futures[future]
                for child in future.result():
                    if child["mimeType"] == FOLDER_MIME_TYPE:
                        create_futures[pool.submit(create_folder, child["name"], dest)] = child["id"]
                    else:
                        copy_futures.append(pool.submit(copy_file, child["id"], child["name"], dest))

            next_level = []
            for future in as_completed(create_futures):
                created = future.result()
                next_level.append((create_futures[future], created["id"]))
            for future in as_completed(copy_futures):
                future.result()
            level = next_level


def initialize_client_folder(client_code: str, parent_id: str, template_folder_id: str) -> dict:
    """clientCode名のフォルダをparent_id直下に作成し、template_folder_idと同じ
    サブフォルダ構成をその下に複製する。

    戻り値には作成したフォルダ本体に加え、直下の"受領"/"整理済"フォルダ(存在すれば)
    のIDを含める。呼び出し側でクライアントのreceiptFolderId/renamedFolderIdに
    反映するため。
    """
    folder = create_folder(client_code, parent_id)
    replicate_folder_structure(template_folder_id, folder["id"])
    receipt_folder = find_folder("受領", folder["id"])
    renamed_folder = find_folder("整理済", folder["id"])
    return {
        "folder": folder,
        "receiptFolderId": receipt_folder["id"] if receipt_folder else None,
        "renamedFolderId": renamed_folder["id"] if renamed_folder else None,
    }
