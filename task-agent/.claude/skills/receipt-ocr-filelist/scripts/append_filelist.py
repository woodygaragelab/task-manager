"""
受領フォルダの分類結果(支払・売上・給与・銀行通帳)を filelist.xlsx に追記する。
ファイルが無ければヘッダー付きで新規作成し、旧フォーマット(分類/区分/支払方法/消費税額/
仕訳No/勘定科目名列が無い)の場合はヘッダー行に不足列を追加する(既存データ行はそのまま)。

使い方:
    python append_filelist.py <entries.jsonのパス> <filelist.xlsxのパス>

entries.json は次の形式のリスト(1要素=1ファイル)。支払以外(売上・給与・銀行通帳)は
OCRを行わないため、classification 以外の内容系フィールド(date/amount/vendor/...)は
省略してよい(省略時は空欄になる):
[
  {
    "filename": "IMG_20260611_091550.jpg",
    "modified_at": "2026-06-11T09:15:50", // 受領ファイルの更新日(JST)。null可。旧キー taken_at も可
    "size_mb": 3.34,
    "type": "JPEG画像",
    "classification": "支払",            // "支払"/"売上"/"給与"/"銀行通帳"。省略時は"支払"扱い
    "date": "2026-02-04",                // 領収書に記載の日付 (YYYY-MM-DD)。支払のみ
    "amount": 5800,
    "vendor": "東京空港交通(株)・京成バス(株)",
    "content": "リムジンバス 成田空港T2→新浦安駅(片道乗車券・大人2名)",
    "category": "領収書",                // "領収書" or "請求書"。支払のみ
    "payment_method": "現金",            // 現金/カード/振込/不明。支払のみ
    "tax_amount": 527,                   // 消費税額の記載(無ければ null)。支払のみ
    "remarks": "「のコピー」を削除してリネーム(元のファイル名: ...)",
                                          // 備考(任意)。new_files.json の同名キーをそのまま渡す。
                                          // filelist.xlsx の remarks 列に書かれる。
    "account_name": "旅費交通費"          // master/TKCマスタ.xlsx の勘定科目コード表と照合した
                                          // 参考の勘定科目名(借方相当)。判断できなければ null。
                                          // 支払のみ。
                                          // ※ここでは仕訳(借方/貸方コード)は確定させない。
                                          //   最終的な科目コードは convert-pattern-b /
                                          //   receipt-to-journal スキル側で決定する。
  }
]
新規行の「仕訳No」列は常に空欄のまま(まだ仕訳化されていない印。receipt-to-journal スキルが
処理後に値を入れる)。receipt-to-journal スキルは仕訳化の対象を「分類」列が"支払"の行に
限定すること(売上・給与・銀行通帳の行は仕訳化しない)。
"""
import sys, os, json, datetime
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, Alignment

from organized_names import organized_rel_path

HEADERS = ["No.", "受領ファイル名", "受領ファイル作成日", "サイズ(MB)", "種類", "整理済ファイル名",
           "整理済ファイル作成日", "分類", "日付", "金額", "取引先", "内容", "区分", "支払方法",
           "消費税額", "仕訳No", "勘定科目名", "remarks"]
# 旧ヘッダー名 -> 新ヘッダー名(既存ファイルのヘッダー行をその場でリネームする)
RENAMED_HEADERS = {"ファイル名": "受領ファイル名", "撮影日時": "受領ファイル作成日"}
# 「種類」の右に挿入する列(旧フォーマットのファイルには無い)
INSERT_AFTER_TYPE = ["整理済ファイル名", "整理済ファイル作成日"]
JST = datetime.timezone(datetime.timedelta(hours=9))
# 既存ファイルのヘッダーを補完する際に、このスキルが追加してよい列(「仕訳No」は含めない)。
# 「仕訳No」列は receipt-to-journal スキル側が、移行時の過去分バックフィルとセットで
# 追加する責任を持つ。ここで先に追加してしまうと、その移行処理が二度と行われなくなり、
# 過去の行がいつまでも「未仕訳」に見えてしまう。
HEADERS_TO_BACKFILL = [h for h in HEADERS if h != "仕訳No"]


def migrate_headers(ws):
    """旧フォーマットのヘッダーを新フォーマットへ移行する(既存データ行はそのまま)。
    ①「ファイル名」「撮影日時」を新名称へリネーム ②「整理済ファイル名」
    「整理済ファイル作成日」が無ければ「種類」の右に列を挿入する(既存行は空欄)。"""
    for c in ws[1]:
        if c.value in RENAMED_HEADERS:
            c.value = RENAMED_HEADERS[c.value]
    headers = [c.value for c in ws[1]]
    if "種類" not in headers:
        return
    insert_at = headers.index("種類") + 2  # 「種類」の右隣(1始まり)
    for h in INSERT_AFTER_TYPE:
        if h in headers:
            continue
        ws.insert_cols(insert_at)
        cell = ws.cell(row=1, column=insert_at, value=h)
        cell.font = Font(name="Arial", bold=True)
        cell.alignment = Alignment(horizontal="center")
        insert_at += 1


def parse_dt(value):
    """ISO文字列をdatetimeにする(tzありはJSTへ変換してnaiveにする。xlsxはtz非対応のため)。"""
    dt = datetime.datetime.fromisoformat(value)
    if dt.tzinfo is not None:
        dt = dt.astimezone(JST).replace(tzinfo=None)
    return dt


def open_or_create(path):
    if os.path.exists(path):
        wb = load_workbook(path)
        ws = wb["receipt"] if "receipt" in wb.sheetnames else wb.active
        migrate_headers(ws)
        existing_headers = [c.value for c in ws[1] if c.value is not None]
        for h in HEADERS_TO_BACKFILL:
            if h not in existing_headers:
                col_idx = ws.max_column + 1
                cell = ws.cell(row=1, column=col_idx, value=h)
                cell.font = Font(name="Arial", bold=True)
                cell.alignment = Alignment(horizontal="center")
                existing_headers.append(h)
    else:
        wb = Workbook()
        ws = wb.active
        ws.title = "receipt"
        ws.append(HEADERS)
        for c in ws[1]:
            c.font = Font(name="Arial", bold=True)
            c.alignment = Alignment(horizontal="center")
    return wb, ws


def next_seq(ws, col_idx):
    max_no = 0
    for row in ws.iter_rows(min_row=2, values_only=True):
        v = row[col_idx - 1] if len(row) >= col_idx else None
        if v and isinstance(v, (int, float)):
            max_no = max(max_no, int(v))
    return max_no + 1


def compact_blank_rows(ws):
    """全列が空の行を削除する。Googleスプレッドシート等で一度開いて保存し直された
    xlsxは、実データの行数に関わらずシートの「使用範囲」だけが大きく広がって
    保存されることがある。その状態でws.max_row(使用範囲の最終行を返す)を追記位置の
    起点に使うと、次の追記が実データよりはるか下の行から始まり、大量の空白行が
    放置されたまま気づかれにくくなる。ここで実際に値の無い行を都度削除しておくことで、
    ws.max_rowが常に実データの最終行と一致するようにする。"""
    blank_rows = [
        row[0].row
        for row in ws.iter_rows(min_row=2, max_row=ws.max_row)
        if all(c.value is None for c in row)
    ]
    for r in reversed(blank_rows):
        ws.delete_rows(r, 1)


def main():
    entries_path, filelist_path = sys.argv[1], sys.argv[2]
    entries = json.load(open(entries_path, encoding="utf-8"))

    wb, ws = open_or_create(filelist_path)
    compact_blank_rows(ws)
    header_row = [c.value for c in ws[1]]
    col = {h: i + 1 for i, h in enumerate(header_row) if h}
    no = next_seq(ws, col["No."])

    processed_at = datetime.datetime.now(JST).replace(tzinfo=None, microsecond=0)

    for e in entries:
        # modified_at: 受領ファイルの更新日(drive_sync_download.pyが出力)。旧キーtaken_atも読む
        modified_at_raw = e.get("modified_at") or e.get("taken_at")
        modified_at = parse_dt(modified_at_raw) if modified_at_raw else None
        r = ws.max_row + 1
        ws.cell(row=r, column=col["No."], value=no)
        ws.cell(row=r, column=col["受領ファイル名"], value=e["filename"])
        if modified_at:
            c = ws.cell(row=r, column=col["受領ファイル作成日"], value=modified_at)
            c.number_format = "yyyy-mm-dd hh:mm:ss"
        ws.cell(row=r, column=col["サイズ(MB)"], value=e["size_mb"]).number_format = "0.00"
        ws.cell(row=r, column=col["種類"], value=e["type"])
        # 整理済ファイル名はサブフォルダ込みの相対パス。作成日は処理実行日時
        ws.cell(row=r, column=col["整理済ファイル名"], value=organized_rel_path(e))
        ws.cell(row=r, column=col["整理済ファイル作成日"], value=processed_at).number_format = "yyyy-mm-dd hh:mm:ss"
        ws.cell(row=r, column=col["分類"], value=e.get("classification", "支払"))
        if e.get("date"):
            c = ws.cell(row=r, column=col["日付"], value=datetime.datetime.strptime(e["date"], "%Y-%m-%d"))
            c.number_format = "yyyy-mm-dd"
        if e.get("amount") is not None:
            ws.cell(row=r, column=col["金額"], value=e["amount"]).number_format = "#,##0"
        ws.cell(row=r, column=col["取引先"], value=e.get("vendor"))
        ws.cell(row=r, column=col["内容"], value=e.get("content"))
        ws.cell(row=r, column=col["区分"], value=e.get("category"))
        ws.cell(row=r, column=col["支払方法"], value=e.get("payment_method"))
        if e.get("tax_amount") is not None:
            ws.cell(row=r, column=col["消費税額"], value=e["tax_amount"]).number_format = "#,##0"
        if "勘定科目名" in col:
            ws.cell(row=r, column=col["勘定科目名"], value=e.get("account_name"))
        if "remarks" in col:
            ws.cell(row=r, column=col["remarks"], value=e.get("remarks"))
        # 「仕訳No」は空欄のまま(receipt-to-journal スキルが後で埋める)
        for cell in ws[r]:
            cell.font = Font(name="Arial")
        no += 1

    wb.save(filelist_path)
    print(f"receipt_filelist: +{len(entries)}行 -> {filelist_path}")


if __name__ == "__main__":
    main()
