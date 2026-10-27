r"""
receipt_filelist.xlsx に追記した新規領収書ファイルを、renamed フォルダ直下に
コピー保存する(Step 4。勘定科目ごとのサブフォルダは作らない)。ファイル名は
"<日付YYYYMMDD>_<取引先>_<金額>円_<勘定科目名>.<拡張子>" にリネームされる。

使い方:
    python rename_and_save.py <entries.jsonのパス> <受領フォルダ>

entries.json は append_filelist.py と同じ形式(Step 3 で作成したものをそのまま再利用する)。
このスクリプトは新規追加分だけを対象にする(filelist全体の再走査はしない)。

保存先:
    <受領フォルダの親フォルダ(=関与先フォルダ)>\renamed\ 配下の、受領側と同じサブフォルダ/
        <日付>_<取引先>_<金額>円_<勘定科目名>.<拡張子>
    例: 受領フォルダが ...\Data\MAX\receipt なら、保存先は ...\Data\MAX\renamed\
    (関与先フォルダはどの案件でも共通してこの構造なので、案件コードを別途渡す必要はない)

勘定科目名が null または空の場合は、ファイル名の科目名部分を「未分類」とする。
取引先が null または空の場合はファイル名に「取引先不明」と入れる。

同名ファイルが既に存在する場合は上書きする(再実行時に同じ領収書を処理し直しても
ファイルが増え続けないようにするため)。
"""
import sys, os, json, shutil

from organized_names import safe_component, organized_rel_path  # noqa: F401 (safe_componentは再エクスポート)


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

        # 受領フォルダと同じサブフォルダ構成で保存する(サブフォルダ違いの同名衝突も避けられる)
        e = {**e, "classification": "支払"}
        dest = os.path.join(renamed_root, *organized_rel_path(e).split("/"))
        os.makedirs(os.path.dirname(dest), exist_ok=True)

        overwritten = os.path.exists(dest)
        shutil.copy2(src, dest)
        saved.append({"filename": filename, "dest": dest, "overwritten": overwritten})

    for s in saved:
        tag = "(上書き)" if s["overwritten"] else ""
        print(f"{s['filename']} -> {s['dest']} {tag}")
    print(f"合計 {len(saved)} 件を renamed フォルダへ保存しました。")


if __name__ == "__main__":
    main()
