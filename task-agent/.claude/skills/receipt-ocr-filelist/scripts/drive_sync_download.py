"""
Step1相当(Drive上の新規ファイルの検出とダウンロード)を、判断を伴わない機械的な
処理として1回のスクリプト実行にまとめたもの。旧来の「Claudeがsearch_files /
download_file_contentをファイル数ぶん逐次呼ぶ」方式に代えて、Drive APIを直接
(かつ新規ファイルのダウンロードは並列に)呼び出すことで高速化する。

使い方:
    python drive_sync_download.py <client_code> [--work-dir DIR]
        [--receipt-folder-id ID] [--concurrency N] [--limit N]

--limit は1回の実行で処理する新規ファイル数の上限(既定10)。超過分はダウンロード
せず、出力の remaining に件数だけ返す(次回実行で再び新規として検出される)。

client_code はtaskmanagerのクライアントマスタ(TaskClients)のclientCode。
--receipt-folder-id を指定した場合はクライアントマスタの参照を省略できる
(DynamoDBの環境変数が無いローカル実行・テスト向け)。

出力(stdout, JSON): scan_new_receipts.pyと同じ"filename/taken_at/size_mb/type"を
持つ新規ファイルのリスト(taken_atの代わりにDriveの更新日をJSTにしたmodified_at)に、file_id(Drive上のID)とreceipt_folder_id/
old_filelist_file_id(Step5相当のアップロード側で使う)を加えたもの。
同じ内容を <work_dir>/new_files.json にも書き出す。

タイミングログ(stderr): [timing] phase=list_files / download_filelist / diff /
download_file(extra: filename) / total
"""
import argparse
import datetime
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

from googleapiclient.http import MediaIoBaseDownload

from drive_sync_common import (
    FOLDER_MIME_TYPE,
    Timing,
    execute_with_retry,
    get_drive_service,
    log,
    resolve_client_folders,
)
from scan_new_receipts import EXT_TYPE

FILELIST_NAME = "filelist.xlsx"
JST = datetime.timezone(datetime.timedelta(hours=9))


def to_jst_iso(drive_time):
    """Driveのmodifiedtime(RFC3339, UTC)をJSTのISO文字列にする。None/不正値はNone。"""
    if not drive_time:
        return None
    try:
        dt = datetime.datetime.fromisoformat(drive_time.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.astimezone(JST).replace(tzinfo=None, microsecond=0).isoformat()


def find_client_folder_id(receipt_folder_id: str) -> str:
    """受領フォルダの親(=クライアントフォルダ)のIDを返す。"""
    service = get_drive_service()
    meta = execute_with_retry(
        service.files().get(fileId=receipt_folder_id, fields="parents", supportsAllDrives=True)
    )
    parents = meta.get("parents") or []
    if not parents:
        raise RuntimeError(f"receipt_folder_id={receipt_folder_id!r} に親フォルダがありません")
    return parents[0]


def find_filelist_entry(timing: Timing, client_folder_id: str):
    """クライアントフォルダ直下(受領フォルダと並列)のfilelist.xlsxを探す(無ければNone)。"""
    with timing.phase("find_filelist"):
        service = get_drive_service()
        resp = execute_with_retry(
            service.files().list(
                q=f"'{client_folder_id}' in parents and name = '{FILELIST_NAME}' and trashed = false",
                fields="files(id, name, mimeType, size, modifiedTime)",
                pageSize=10,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
        )
    files = [f for f in resp.get("files", []) if f["mimeType"] != FOLDER_MIME_TYPE]
    return files[0] if files else None


def list_receipt_tree(timing: Timing, root_folder_id: str):
    """受領フォルダ配下を再帰的に列挙する。戻り値はファイル一覧
    [{id,name,mimeType,size,rel_path}]。"""
    files = []
    with timing.phase("list_files"):
        service = get_drive_service()
        queue = [(root_folder_id, "")]
        while queue:
            parent_id, prefix = queue.pop(0)
            page_token = None
            while True:
                resp = execute_with_retry(
                    service.files().list(
                        q=f"'{parent_id}' in parents and trashed = false",
                        fields="nextPageToken, files(id, name, mimeType, size, modifiedTime)",
                        pageSize=200,
                        pageToken=page_token,
                        supportsAllDrives=True,
                        includeItemsFromAllDrives=True,
                    )
                )
                for f in resp.get("files", []):
                    if f["mimeType"] == FOLDER_MIME_TYPE:
                        queue.append((f["id"], f"{prefix}{f['name']}/"))
                        continue
                    files.append({**f, "rel_path": f"{prefix}{f['name']}"})
                page_token = resp.get("nextPageToken")
                if not page_token:
                    break
    log(f"[list_files] {len(files)} file(s)")
    return files


COPY_SUFFIX_RE = re.compile(r"\s*のコピー(?:\s*\(\d+\))?")


def strip_copy_suffix(name: str) -> str:
    """Driveで複製した際に付く「のコピー」を除いた名前を返す。
    例: "79976.jpg のコピー" -> "79976.jpg" / "a のコピー.jpg" -> "a.jpg" """
    return COPY_SUFFIX_RE.sub("", name).strip()


def rename_copy_files(timing: Timing, files: list):
    """名前に「のコピー」を含むファイルをDrive上で正しい名前へリネームし、
    files(list_receipt_tree()の戻り値)の name/rel_path も更新する。
    同じフォルダに変換後と同名のファイルが既にある場合は上書き・重複を避けるため
    リネームせずスキップする(警告ログのみ)。
    戻り値は {処理後のrel_path: filelist.xlsxのremarks列に書く文言}。"""
    remarks = {}
    with timing.phase("rename_copy"):
        service = get_drive_service()
        taken = {f["rel_path"] for f in files}
        for f in files:
            if "のコピー" not in f["name"]:
                continue
            new_name = strip_copy_suffix(f["name"])
            if not new_name or new_name == f["name"]:
                continue
            new_rel = f["rel_path"][: len(f["rel_path"]) - len(f["name"])] + new_name
            if new_rel in taken:
                log(f"[rename_copy] skip (同名ファイルが既に存在): {f['rel_path']!r} -> {new_rel!r}")
                remarks[f["rel_path"]] = (
                    f"「のコピー」を削除すると同名ファイル({new_name})が存在するためリネームせず処理"
                )
                continue
            execute_with_retry(
                service.files().update(
                    fileId=f["id"], body={"name": new_name}, supportsAllDrives=True
                )
            )
            taken.discard(f["rel_path"])
            taken.add(new_rel)
            log(f"[rename_copy] {f['rel_path']!r} -> {new_rel!r}")
            remarks[new_rel] = f"「のコピー」を削除してリネーム(元のファイル名: {f['name']})"
            f["name"], f["rel_path"] = new_name, new_rel
    return remarks


def download_existing_filelist(timing: Timing, filelist_entry: dict, dest_path: str):
    with timing.phase("download_filelist"):
        service = get_drive_service()
        request = service.files().get_media(fileId=filelist_entry["id"], supportsAllDrives=True)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(dest_path, "wb") as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = execute_with_retry_downloader(downloader)
    log(f"[download_filelist] {filelist_entry['name']} -> {dest_path}")


def execute_with_retry_downloader(downloader, max_retries: int = 5, base_delay: float = 1.0):
    """MediaIoBaseDownload.next_chunk()はHttpErrorを投げうるが引数を取らないため
    execute_with_retryのシグネチャに合わないので専用の薄いリトライを用意する。"""
    import random
    import time as _time

    from googleapiclient.errors import HttpError

    for attempt in range(max_retries + 1):
        try:
            return downloader.next_chunk()
        except HttpError as e:
            status = e.resp.status if e.resp is not None else None
            if status not in (429, 500, 502, 503, 504) or attempt == max_retries:
                raise
            delay = base_delay * (2**attempt) + random.uniform(0, 0.5)
            log(f"[retry] download status={status} attempt={attempt + 1}/{max_retries} wait={delay:.1f}s")
            _time.sleep(delay)


def diff_new_files(
    timing: Timing, remote_files: list, local_filelist_path: str, remarks: dict = None
) -> list:
    """既存filelist.xlsxの「ファイル名」列と突き合わせ、未記載のものだけ
    新規ファイルとして返す(scan_new_receipts.pyと同じロジック)。"""
    with timing.phase("diff"):
        existing = set()
        if os.path.exists(local_filelist_path):
            from openpyxl import load_workbook

            wb = load_workbook(local_filelist_path, read_only=True)
            ws = wb.active
            for row in ws.iter_rows(min_row=2, values_only=True):
                if row and row[1]:
                    existing.add(str(row[1]).replace("\\", "/"))

        new_files = []
        for f in remote_files:
            ext = os.path.splitext(f["name"])[1].lower()
            if ext not in EXT_TYPE:
                continue
            if f["rel_path"] in existing:
                continue
            size_mb = round(int(f.get("size", 0)) / 1024 / 1024, 2)
            entry = {
                "filename": f["rel_path"],
                "modified_at": to_jst_iso(f.get("modifiedTime")),
                "size_mb": size_mb,
                "type": EXT_TYPE[ext],
                "file_id": f["id"],
            }
            if remarks and f["rel_path"] in remarks:
                entry["remarks"] = remarks[f["rel_path"]]
            new_files.append(entry)
    log(f"[diff] {len(new_files)} new file(s) out of {len(remote_files)}")
    return new_files


def download_one(timing: Timing, entry: dict, receipt_dir: str):
    dest = os.path.join(receipt_dir, *entry["filename"].split("/"))
    with timing.phase("download_file", {"filename": entry["filename"]}):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        service = get_drive_service()
        request = service.files().get_media(fileId=entry["file_id"], supportsAllDrives=True)
        with open(dest, "wb") as fh:
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while not done:
                _, done = execute_with_retry_downloader(downloader)
    return dest


def download_new_files(timing: Timing, new_files: list, receipt_dir: str, concurrency: int):
    if not new_files:
        return
    errors = []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        future_to_entry = {
            pool.submit(download_one, timing, entry, receipt_dir): entry for entry in new_files
        }
        for future in as_completed(future_to_entry):
            entry = future_to_entry[future]
            try:
                future.result()
            except Exception as e:
                log(f"[error] download failed filename={entry['filename']!r}: {e}")
                errors.append({"filename": entry["filename"], "error": str(e)})
    if errors:
        raise RuntimeError(
            f"{len(errors)}件のダウンロードに失敗しました: "
            + json.dumps(errors, ensure_ascii=False)
        )


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("client_code")
    parser.add_argument("--work-dir", default=None, help="デフォルト: /tmp/{client_code}")
    parser.add_argument("--receipt-folder-id", default=None)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--limit", type=int, default=10)
    args = parser.parse_args()

    work_dir = args.work_dir or os.path.join("/tmp", args.client_code)
    receipt_dir = os.path.join(work_dir, "receipt")
    os.makedirs(receipt_dir, exist_ok=True)

    receipt_folder_id = args.receipt_folder_id
    if not receipt_folder_id:
        client = resolve_client_folders(args.client_code)
        receipt_folder_id = client.get("receiptFolderId")
        if not receipt_folder_id:
            print(
                json.dumps(
                    {"error": f"client_code={args.client_code!r} にreceiptFolderIdが未設定です"},
                    ensure_ascii=False,
                )
            )
            sys.exit(1)

    timing = Timing()
    remote_files = list_receipt_tree(timing, receipt_folder_id)
    client_folder_id = find_client_folder_id(receipt_folder_id)
    filelist_entry = find_filelist_entry(timing, client_folder_id)
    remarks = rename_copy_files(timing, remote_files)

    # ローカルでも受領フォルダ(receipt/)とは別に、work_dir直下へ置く
    local_filelist_path = os.path.join(work_dir, FILELIST_NAME)
    if filelist_entry:
        download_existing_filelist(timing, filelist_entry, local_filelist_path)
    elif os.path.exists(local_filelist_path):
        # Drive側に一覧が無いのに前回実行のローカル残骸があると、それを「処理済み」の
        # 根拠として誤って参照してしまう。Driveを唯一の正とし、残骸は破棄する。
        os.remove(local_filelist_path)
        log(f"[stale] Drive上にfilelistが無いため古いローカルコピーを削除: {local_filelist_path}")

    all_new_files = diff_new_files(timing, remote_files, local_filelist_path, remarks)
    new_files = all_new_files[: args.limit]
    remaining = len(all_new_files) - len(new_files)
    if remaining:
        log(f"[limit] 新規{len(all_new_files)}件のうち{len(new_files)}件を処理対象とし、残り{remaining}件は次回に回す")
    download_new_files(timing, new_files, receipt_dir, args.concurrency)

    total_ms = timing.total()

    result = {
        "client_code": args.client_code,
        "receipt_folder_id": receipt_folder_id,
        "client_folder_id": client_folder_id,
        "old_filelist_file_id": filelist_entry["id"] if filelist_entry else None,
        "new_files": new_files,
        "total_new": len(all_new_files),
        "remaining": remaining,
        "elapsed_ms": total_ms,
    }
    state_path = os.path.join(work_dir, "new_files.json")
    with open(state_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
