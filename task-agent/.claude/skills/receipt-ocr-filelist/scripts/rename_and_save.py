"""
receipt_filelist.xlsx に追記した新規領収書ファイルを、勘定科目名ごとのフォルダに
コピー保存する(Step 4)。ファイル名は
"<勘定科目名>_<日付YYYYMMDD>_<金額>円_<取引先>.<拡張子>" にリネームされる。

使い方:
    python rename_and_save.py <entries.jsonのパス> <受領フォルダ>

entries.json は append_filelist.py と同じ形式(Step 3 で作成したものをそのまま再利用する)。
このスクリプトは新規追加分だけを対象にする(filelist全体の再走査はしない)。

保存先:
    <受領フォルダの親フォルダ(=関与先フォルダ)>\renamed\<勘定科目名>\
        <勘定科目名>_<日付>_<金額>円_<取引先>.<拡張子>
    例: 受領フォルダが ...\Data\MAX\receipt なら、保存先は ...\Data\MAX\renamed\...
    (関与先フォルダはどの案件でも共通してこの構造なので、案件コードを別途渡す必要はない)

勘定科目名が null または空の場合は「未分類」フォルダに保存する(Step 2 で科目名の判断が
つかなかった領収書を後から見つけやすくするため)。取引先が null または空の場合は
ファイル名に「取引先不明」と入れる。

同名ファイルが既に存在する場合は上書きする(再実行時に同じ領収書を処理し直しても
ファイルが増え続けないようにするため)。
"""
import sys, os, json, shutil

def safe_component(s, fallback):
    """フォルダ名・ファイル名に使えない文字を除去する。"""
    if not s:
        return fallback
    s = str(s)
    for ch in '\\/:*?"<>|':
        s = s.replace(ch, "")
    return s.strip() or fallback


def main():
    entries_path, receipt_dir = sys.argv[1], sys.argv[2]
    entries = json.load(open(entries_path, encoding="utf-8"))

    receipt_dir = os.path.normpath(receipt_dir)
    base_dir = os.path.dirname(receipt_dir)  # 関与先フォルダ (例: ...\Data\MAX)
    renamed_root = os.path.join(base_dir, "renamed")

    saved = []
    for e in entries:
        filename = e["filename"]
        # filename はサブフォルダ内なら "サブフォルダ名\ファイル名" 形式(Windows流)で
        # 記録されている場合がある。実行環境の区切り文字に正規化してから結合する。
        src = os.path.join(receipt_dir, *filename.replace("\\", "/").split("/"))
        if not os.path.exists(src):
            print(f"[skip] 元ファイルが見つかりません: {src}")
            continue

        account = safe_component(e.get("account_name"), "未分類")
        vendor = safe_component(e.get("vendor"), "取引先不明")
        date_str = (e.get("date") or "日付不明").replace("-", "")
        amount = e.get("amount")
        amount_str = f"{amount}円" if amount is not None else "金額不明"
        ext = os.path.splitext(filename)[1].lower()

        dest_dir = os.path.join(renamed_root, account)
        os.makedirs(dest_dir, exist_ok=True)
        dest_name = f"{account}_{date_str}_{amount_str}_{vendor}{ext}"
        dest = os.path.join(dest_dir, dest_name)

        overwritten = os.path.exists(dest)
        shutil.copy2(src, dest)
        saved.append({"filename": filename, "dest": dest, "overwritten": overwritten})

    for s in saved:
        tag = "(上書き)" if s["overwritten"] else ""
        print(f"{s['filename']} -> {s['dest']} {tag}")
    print(f"合計 {len(saved)} 件を renamed フォルダへ保存しました。")


if __name__ == "__main__":
    main()
