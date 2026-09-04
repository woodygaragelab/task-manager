"""
drive_sync_download.py / drive_sync_upload.py が共有するユーティリティ。
Google Driveへの決定的な(LLM判断を伴わない)機械的操作をまとめる。

- Secrets ManagerからのOAuthリフレッシュトークン取得・Drive v3クライアント構築
  (task_agent.py の _get_google_token_info / _get_drive_service と同じ方式)
- taskmanagerのクライアントマスタ(TaskClients)からのフォルダID解決
  (task_repository.list_clients() 経由。DynamoDBの環境変数が無い実行環境向けに
  遅延importにしてあるので、--folder-id 系オプションだけで動かす分には不要)
- レート制限(429/403 rateLimitExceeded等)に対する指数バックオフ再試行
- フェーズ計測ログ(stderrに`[timing] phase=... elapsed_ms=...`形式で出力)
- 「同名(parent_id, name)フォルダの検索 or 作成」のスレッドセーフなヘルパー
  (勘定科目フォルダなどへの並行アップロード時に、初回作成が競合して重複フォルダが
  できるのを防ぐ)
"""
import json
import os
import random
import sys
import threading
import time
from contextlib import contextmanager

import boto3
from google.oauth2.credentials import Credentials as UserCredentials
from googleapiclient.discovery import build as build_drive_service
from googleapiclient.errors import HttpError

AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-1")
GOOGLE_USER_TOKEN_SECRET_NAME = os.environ.get(
    "GOOGLE_USER_TOKEN_SECRET_NAME", "task-agent/google-drive-user-token"
)
DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

RETRYABLE_STATUS = {429, 500, 502, 503, 504}
RETRYABLE_403_REASONS = {"rateLimitExceeded", "userRateLimitExceeded"}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# 認証 / Driveクライアント (task_agent.py._get_drive_service と同じ方式:
# 実ユーザーのOAuthリフレッシュトークンをSecrets Managerから取得する。
# サービスアカウントはストレージクォータを持たずアップロードに失敗するため使わない)
# ---------------------------------------------------------------------------

_credentials = None
_credentials_lock = threading.Lock()
_thread_local = threading.local()


def _get_credentials() -> UserCredentials:
    global _credentials
    if _credentials is not None:
        return _credentials
    with _credentials_lock:
        if _credentials is not None:
            return _credentials
        secrets_client = boto3.client("secretsmanager", region_name=AWS_REGION)
        secret_value = secrets_client.get_secret_value(SecretId=GOOGLE_USER_TOKEN_SECRET_NAME)
        token_info = json.loads(secret_value["SecretString"])
        _credentials = UserCredentials(
            token=None,
            refresh_token=token_info["refresh_token"],
            client_id=token_info["client_id"],
            client_secret=token_info["client_secret"],
            token_uri=token_info["token_uri"],
            scopes=token_info.get("scopes", DRIVE_SCOPES),
        )
        return _credentials


def get_drive_service():
    """スレッドごとに独立したDrive v3クライアントを返す(内部のhttp
    トランスポートはスレッドセーフではないため、スレッド間で使い回さない)。"""
    service = getattr(_thread_local, "drive_service", None)
    if service is not None:
        return service
    service = build_drive_service(
        "drive", "v3", credentials=_get_credentials(), cache_discovery=False
    )
    _thread_local.drive_service = service
    return service


def resolve_client_folders(client_code: str) -> dict:
    """taskmanagerのクライアントマスタ(TaskClients)から、client_codeに対応する
    receiptFolderId/renamedFolderIdを取得する。DynamoDBアクセス用の環境変数
    (CLIENTS_TABLE等)が無い実行環境では、代わりに --receipt-folder-id /
    --organized-folder-id を明示的に渡すこと。"""
    project_root = os.path.abspath(
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..")
    )
    if project_root not in sys.path:
        sys.path.insert(0, project_root)
    try:
        import task_repository as repo
    except (ImportError, KeyError) as e:
        raise RuntimeError(
            "task_repositoryの読み込みに失敗しました"
            "(CLIENTS_TABLE等の環境変数が無い可能性があります)。"
            "--receipt-folder-id / --organized-folder-id で直接指定してください。"
            f" (原因: {e})"
        ) from e

    for client in repo.list_clients():
        if client.get("clientCode") == client_code:
            return client
    raise RuntimeError(f"client_code={client_code!r} がクライアントマスタに見つかりません")


# ---------------------------------------------------------------------------
# レート制限対応の再試行ラッパー
# ---------------------------------------------------------------------------


def execute_with_retry(request, max_retries: int = 5, base_delay: float = 1.0):
    """Drive APIのリクエストオブジェクト(未実行の`.execute()`呼び出し可能な
    もの)を、429/レート制限系エラーに対して指数バックオフしながら実行する。"""
    for attempt in range(max_retries + 1):
        try:
            return request.execute()
        except HttpError as e:
            status = e.resp.status if e.resp is not None else None
            reason = ""
            try:
                reason = json.loads(e.content).get("error", {}).get("errors", [{}])[0].get(
                    "reason", ""
                )
            except Exception:
                pass
            retryable = status in RETRYABLE_STATUS or (
                status == 403 and reason in RETRYABLE_403_REASONS
            )
            if not retryable or attempt == max_retries:
                raise
            delay = base_delay * (2**attempt) + random.uniform(0, 0.5)
            log(
                f"[retry] Drive API status={status} reason={reason!r} "
                f"attempt={attempt + 1}/{max_retries} wait={delay:.1f}s"
            )
            time.sleep(delay)


# ---------------------------------------------------------------------------
# フェーズ計測
# ---------------------------------------------------------------------------


class Timing:
    def __init__(self):
        self._start = time.monotonic()
        self._records = []
        self._lock = threading.Lock()

    @contextmanager
    def phase(self, name: str, extra=None):
        t0 = time.monotonic()
        try:
            yield
        finally:
            elapsed_ms = round((time.monotonic() - t0) * 1000)
            with self._lock:
                self._records.append({"phase": name, "extra": extra, "elapsed_ms": elapsed_ms})
            extra_str = f" extra={json.dumps(extra, ensure_ascii=False)}" if extra else ""
            log(f"[timing] phase={name}{extra_str} elapsed_ms={elapsed_ms}")

    def total(self) -> int:
        elapsed_ms = round((time.monotonic() - self._start) * 1000)
        log(f"[timing] phase=total elapsed_ms={elapsed_ms}")
        return elapsed_ms


# ---------------------------------------------------------------------------
# フォルダ検索 or 作成(スレッドセーフ)
# ---------------------------------------------------------------------------

_folder_locks: dict = {}
_folder_locks_guard = threading.Lock()
_folder_cache: dict = {}


def _lock_for(key):
    with _folder_locks_guard:
        lock = _folder_locks.get(key)
        if lock is None:
            lock = threading.Lock()
            _folder_locks[key] = lock
        return lock


def search_or_create_folder(parent_id: str, name: str, timing: Timing = None) -> str:
    """parent_id直下からname一致のフォルダを検索し、無ければ作成してIDを返す。
    同じ(parent_id, name)への並行呼び出しは内部でロックし、フォルダが
    重複作成されないようにする(結果はプロセス内でキャッシュする)。"""
    key = (parent_id, name)
    cached = _folder_cache.get(key)
    if cached is not None:
        return cached
    with _lock_for(key):
        cached = _folder_cache.get(key)
        if cached is not None:
            return cached
        ctx = timing.phase("search_or_create_folder", {"name": name}) if timing else _noop()
        with ctx:
            service = get_drive_service()
            escaped = name.replace("'", "\\'")
            query = (
                f"'{parent_id}' in parents and name = '{escaped}' "
                f"and mimeType = '{FOLDER_MIME_TYPE}' and trashed = false"
            )
            resp = execute_with_retry(
                service.files().list(q=query, fields="files(id, name)", pageSize=10)
            )
            files = resp.get("files", [])
            if files:
                folder_id = files[0]["id"]
            else:
                created = execute_with_retry(
                    service.files().create(
                        body={
                            "name": name,
                            "parents": [parent_id],
                            "mimeType": FOLDER_MIME_TYPE,
                        },
                        fields="id",
                    )
                )
                folder_id = created["id"]
            _folder_cache[key] = folder_id
            return folder_id


def find_file_by_name(parent_id: str, name: str):
    """parent_id直下からname完全一致のファイルを検索し、見つかればfileIdを、
    無ければNoneを返す(フォルダは対象外)。"""
    service = get_drive_service()
    escaped = name.replace("'", "\\'")
    query = (
        f"'{parent_id}' in parents and name = '{escaped}' "
        f"and mimeType != '{FOLDER_MIME_TYPE}' and trashed = false"
    )
    resp = execute_with_retry(
        service.files().list(q=query, fields="files(id, name)", pageSize=10)
    )
    files = resp.get("files", [])
    return files[0]["id"] if files else None


def upload_file_replacing(local_path: str, parent_id: str, name: str) -> dict:
    """local_pathの内容をparent_id直下にnameとしてアップロードする。同名の
    既存ファイルがあれば、アップロード成功後にゴミ箱へ移動する(逆順にすると
    アップロード失敗時にデータが失われるため、この順序を厳守する)。"""
    import mimetypes

    from googleapiclient.http import MediaFileUpload

    service = get_drive_service()
    existing_id = find_file_by_name(parent_id, name)
    mime_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
    media = MediaFileUpload(local_path, mimetype=mime_type, resumable=False)
    created = execute_with_retry(
        service.files().create(
            body={"name": name, "parents": [parent_id]}, media_body=media, fields="id"
        )
    )
    if existing_id:
        execute_with_retry(service.files().update(fileId=existing_id, body={"trashed": True}))
    return {"file_id": created["id"], "replaced": existing_id is not None}


@contextmanager
def _noop():
    yield
