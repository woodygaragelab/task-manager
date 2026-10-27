"""
受領フォルダ(サブフォルダ含む)内の画像ファイルを調べ、receipt_filelist.xlsx に
まだ載っていない新規ファイルだけを JSON で出力する。

使い方:
    python scan_new_receipts.py <受領フォルダ> <receipt_filelist.xlsxのパス>

出力 (stdout, JSON):
    [
      {"filename": "IMG_20260611_091550.jpg", "modified_at": "2026-06-11T09:15:50",
       "size_mb": 3.34, "type": "JPEG画像"},
      {"filename": "2026年6月\\IMG_20260605_101200.jpg", "modified_at": "2026-06-05T10:12:00",
       "size_mb": 2.10, "type": "JPEG画像"},
      ...
    ]
"filename" は受領フォルダを起点とした相対パス(サブフォルダ内のファイルは
"サブフォルダ名\ファイル名" の形式)。receipt_filelist.xlsx の「受領ファイル名」列には
この値をそのまま書き込むので、実ファイルを開く際は
os.path.join(<受領フォルダ>, filename) で絶対パスを組み立てること。
modified_at はファイルの更新日時(「受領ファイル作成日」列に記録される)。
"""
import sys, os, re, json, datetime
from openpyxl import load_workbook

EXT_TYPE = {
    ".jpg": "JPEG画像", ".jpeg": "JPEG画像", ".png": "PNG画像",
    ".heic": "HEIC画像", ".pdf": "PDFファイル",
    # 売上明細・売上集計表・賃金台帳・銀行の入出金明細などはスキャン画像ではなく
    # Excel/CSVファイルでそのまま受領フォルダに置かれることが多いため対象に含める。
    ".xlsx": "Excelファイル", ".xls": "Excelファイル", ".csv": "CSVファイル",
}

def main():
    receipt_dir, filelist_path = sys.argv[1], sys.argv[2]

    existing = set()
    if os.path.exists(filelist_path):
        wb = load_workbook(filelist_path)
        ws = wb.active
        for row in ws.iter_rows(min_row=2, values_only=True):
            if row and row[1]:
                existing.add(row[1])

    new_files = []
    for dirpath, dirnames, filenames in os.walk(receipt_dir):
        dirnames.sort()
        for f in sorted(filenames):
            ext = os.path.splitext(f)[1].lower()
            if ext not in EXT_TYPE:
                continue
            full_path = os.path.join(dirpath, f)
            rel_path = os.path.relpath(full_path, receipt_dir)
            if rel_path in existing:
                continue
            size_mb = round(os.path.getsize(full_path) / 1024 / 1024, 2)
            modified_at = datetime.datetime.fromtimestamp(
                os.path.getmtime(full_path)
            ).replace(microsecond=0).isoformat()
            new_files.append({
                "filename": rel_path,
                "modified_at": modified_at,
                "size_mb": size_mb,
                "type": EXT_TYPE[ext],
            })

    print(json.dumps(new_files, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
