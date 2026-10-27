"""
整理済ファイルの命名規則を1か所にまとめたモジュール(Drive/AWS非依存)。
append_filelist.py(ファイル一覧への記録)・rename_and_save.py(ローカルのリネーム)・
drive_sync_upload.py(Driveへのアップロード)が同じ名前を使うために共有する。

整理済フォルダは、受領フォルダと同じサブフォルダ構成にする。
    受領: 旧/IMG_0001.jpg  ->  整理済: 旧/20260204_取引先_5800円_旅費交通費.jpg
"""
import os


def safe_component(s, fallback):
    """フォルダ名・ファイル名に使えない文字を除去する。"""
    if not s:
        return fallback
    s = str(s)
    for ch in '\\/:*?"<>|':
        s = s.replace(ch, "")
    return s.strip() or fallback


def payment_dest_name(entry: dict) -> tuple:
    """支払: (勘定科目名, <日付YYYYMMDD>_<取引先>_<金額>円_<勘定科目名>.<拡張子>)。"""
    account = safe_component(entry.get("account_name"), "未分類")
    vendor = safe_component(entry.get("vendor"), "取引先不明")
    date_str = (entry.get("date") or "日付不明").replace("-", "")
    amount = entry.get("amount")
    amount_str = f"{amount}円" if amount is not None else "金額不明"
    ext = os.path.splitext(entry["filename"])[1].lower()
    return account, f"{date_str}_{vendor}_{amount_str}_{account}{ext}"


def passbook_dest_name(entry: dict) -> str:
    """銀行通帳: <最終取引日YYYYMMDD>_<銀行名>.<拡張子>。"""
    date_str = (entry.get("last_transaction_date") or "日付不明").replace("-", "")
    bank = safe_component(entry.get("bank_name"), "銀行名不明")
    ext = os.path.splitext(entry["filename"])[1].lower()
    return f"{date_str}_{bank}{ext}"


def dated_original_dest_name(entry: dict) -> str:
    """売上・給与: <最終取引日YYYYMMDD>_<元ファイル名(拡張子除く)>.<拡張子>。"""
    date_str = (entry.get("last_transaction_date") or "日付不明").replace("-", "")
    base = os.path.basename(entry["filename"].replace("\\", "/"))
    stem, ext = os.path.splitext(base)
    return f"{date_str}_{safe_component(stem, 'ファイル名不明')}{ext.lower()}"


def organized_name(entry: dict) -> str:
    """分類に応じた整理済ファイル名(サブフォルダは含まない)。"""
    classification = entry.get("classification") or "支払"
    if classification == "銀行通帳":
        return passbook_dest_name(entry)
    if classification in ("売上", "給与"):
        return dated_original_dest_name(entry)
    return payment_dest_name(entry)[1]


def organized_subdir(entry: dict) -> str:
    """受領ファイル名のサブフォルダ部分('旧/2026'、直下なら'')。"""
    parts = entry["filename"].replace("\\", "/").split("/")
    return "/".join(parts[:-1])


def organized_rel_path(entry: dict) -> str:
    """整理済フォルダ内の相対パス(受領側と同じサブフォルダ + 整理済ファイル名)。"""
    subdir = organized_subdir(entry)
    name = organized_name(entry)
    return f"{subdir}/{name}" if subdir else name
