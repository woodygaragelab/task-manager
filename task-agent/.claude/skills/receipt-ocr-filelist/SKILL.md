---
name: receipt-ocr-filelist
description: |
  Google Drive上のreceiptフォルダに溜まる領収書・請求書の画像を読み取り(OCR)、
  ファイル一覧(receipt_filelist.xlsx)を更新し、勘定科目名ごとにリネームしたコピーを
  Driveのrenamedフォルダへ保存するスキル(AgentCore版)。対応する関与先(案件)は
  taskmanagerの案件マスタで管理しており、都度MCPツールで取得する(詳細は本文参照)。
  「領収書を整理して」「receiptフォルダを整理して」「領収書一覧を更新して」
  「領収書を分類して」「MAXの領収書を処理して」「IKKのreceiptを整理して」のように
  言われたら必ずこのスキルを使うこと。使用時は最初に必ずどの関与先(案件コード)を
  処理するか確認してから、該当するDriveフォルダIDで作業すること。
  仕訳データの作成は行わない(それは receipt-to-journal スキルの役割)。画像が増えるたびに
  再実行できるよう作られており、未処理(新規)のファイルだけを自動検出して処理する。
  ローカルファイルシステムではなくGoogle Drive上のファイルを対象とする点が、旧来の
  ローカルパス版(C:\Users\woody\...)との違い。
---

# 領収書 OCR → ファイル一覧 自動更新(AgentCore / Google Drive版)

Google Drive上のreceiptフォルダに溜まっていく領収書・請求書の画像を読み取り、
`receipt_filelist.xlsx` に内容を追記し、勘定科目名ごとに整理したコピーをDrive上の
`renamed`フォルダへ保存するスキル。仕訳データ(弥生会計形式)の作成は別スキル
`receipt-to-journal` が担当するので、このスキルでは行わない。何度でも再実行できるように、
前回までに処理済みのファイルは自動でスキップする。

このスキルはGoogle Drive MCPツール(`search_files` / `download_file_content` /
`create_file` / `trash_file`)と、ローカルの一時作業ディレクトリ(`/tmp`)を組み合わせて動く。
既存のPythonスクリプト(`scripts/`配下)は無改造で、`/tmp`上のファイルに対して実行する。

## 対応する関与先(案件)とDriveフォルダID

関与先コードとreceiptフォルダIDの対応表は、このファイルに直書きせず、taskmanagerの
案件マスタ(DynamoDB `TaskClients`テーブル)を、MCPツール `mcp__task-manager__list_clients`
から都度取得する(taskmanagerのWebアプリ・AgentsPanel.jsxも同じテーブルを参照しており、
マスタは1か所で管理している。旧`receipt-agent-clients`テーブル/APIは廃止済み)。

`mcp__task-manager__list_clients` を引数なしで呼び出す。

レスポンス例:

```json
[
  {"clientCode": "AMR", "clientName": "AMORPHOUS事務所", "receiptFolderId": "1lSUy...", "renamedFolderId": null, "lookupBucket": "CLIENT"},
  {"clientCode": "IKK", "clientName": "Ikkoh株式会社", "receiptFolderId": "1w6R9...", "renamedFolderId": "1L-j-...", "lookupBucket": "CLIENT"},
  {"clientCode": "JKL", "clientName": "JAKALULU株式会社", "receiptFolderId": "1weJd...", "renamedFolderId": null, "lookupBucket": "CLIENT"},
  {"clientCode": "MAX", "clientName": "Maximo事業所", "receiptFolderId": "1QZ67...", "renamedFolderId": null, "lookupBucket": "CLIENT"}
]
```

指定された関与先コードがこのレスポンスに無い場合、または `receiptFolderId` が
未設定(キー自体が無い)の場合は、ユーザーにDrive上のreceiptフォルダのURL
(`https://drive.google.com/drive/folders/{フォルダID}`)を確認してから進める。

いずれの関与先でも、フォルダ構成は共通:

- receiptフォルダ(上記APIで取得した`receiptFolderId`)の直下(または再帰的な
  サブフォルダ)に領収書画像
- ファイル一覧: receiptフォルダ直下の `receipt_filelist.xlsx`
- リネーム済みコピーの保存先: receiptフォルダの親フォルダ直下の `renamed` フォルダ
  (Driveの`parentId`をたどって取得する。ローカル版の「関与先フォルダ」に相当)
- 勘定科目名の参照元(参考情報。関与先によらず共通): `master/TKCマスタ.xlsx` の
  「勘定科目コード表」シート(Drive上のパスは別途確認)

## 全体の流れ

### Step 0. 関与先の確認とローカル作業ディレクトリの準備

作業を始める前に、上記のMCPツールを呼び出して現在対応している関与先コード一覧を取得し、
必ずユーザーにどの関与先(案件)を処理するか確認する
(例:「JKL・MAX・AMR・IKKのどれを処理しますか?」のように、APIから取得した候補を
挙げる)。決まったら、以下を用意する。

```bash
mkdir -p /tmp/{案件コード}/receipt /tmp/{案件コード}/renamed
```

以降のStep 1〜5すべてで、この `/tmp/{案件コード}/` を「ローカル版でのreceiptフォルダ」
として扱う。

### Step 1. Drive上の新規ファイルの検出とダウンロード

`search_files` で receiptフォルダID配下を再帰的に列挙する(サブフォルダも
`parentId = '{サブフォルダID}'` で追って辿る)。

```
query: parentId = '{receiptフォルダID}' and trashed = false
```

同時に、receiptフォルダ直下で `title = 'receipt_filelist.xlsx'` を検索し、既存の一覧が
あれば `download_file_content` で取得して `/tmp/{案件コード}/receipt/receipt_filelist.xlsx`
に保存する(無ければこのステップはスキップ、新規作成は Step 3 が担う)。

一覧に載っている画像ファイル名(「ファイル名」列)と、Drive上で見つかったファイル名を
比較し、まだ載っていないものだけを新規ファイルとする(旧来の
`scan_new_receipts.py` と同じロジックを踏襲するため、比較自体はダウンロード後に
`scripts/scan_new_receipts.py` に任せる。次のサブステップ参照)。

新規と判定した画像ファイルを `download_file_content` で取得し、Driveのフォルダ階層を
保った形で `/tmp/{案件コード}/receipt/` 配下に保存する
(例: サブフォルダ「2026年6月」内の画像なら `/tmp/{案件コード}/receipt/2026年6月/IMG_....jpg`)。

ダウンロード後、既存スクリプトで最終的な新規ファイル一覧を確定する
(receipt_filelist.xlsxとの突き合わせを再度ローカルで行う。Drive側の一覧取得だけで
判定を確定させず、ここで二重チェックすることで見落としを防ぐ)。

```bash
python scripts/scan_new_receipts.py "/tmp/{案件コード}/receipt" "/tmp/{案件コード}/receipt/receipt_filelist.xlsx"
```

新規ファイルが0件なら「新しい領収書はありません」と伝えて終了する
(ダウンロード済みの一時ファイルは削除してよい)。

### Step 2. 画像の内容を読み取る

新規ファイルそれぞれを `Read` ツールで画像として開き、内容を確認する(ローカル版と同じ)。
`filename` に「サブフォルダ名\ファイル名」が入っている場合は、
`/tmp/{案件コード}/receipt/<filename>` を開くこと。読み取る項目はローカル版と同一。

- 日付(領収書/請求書に記載の日付。西暦に変換する)
- 金額(合計・請求金額)
- 取引先(発行元の会社名・店名・個人名)
- 内容(何の費用か)
- 区分(「領収書」か「請求書」か)
- 支払方法(現金・カード・振込など。記載が無ければ「不明」)
- 消費税額(明記されていればその金額。無ければ null)
- 勘定科目名(参考情報。master/TKCマスタ.xlsx と照合)

画像が斜め・一部隠れている場合は、Bash + Pillow で該当部分を切り出してから再度 `Read`。

### Step 3. ファイル一覧への追記(ローカルで実行)

Step 2 で読み取った内容を `entries.json` としてまとめ、既存スクリプトをそのまま実行する。

```bash
python scripts/append_filelist.py "/tmp/{案件コード}/entries.json" "/tmp/{案件コード}/receipt/receipt_filelist.xlsx"
```

この時点では `/tmp` 上で完結しており、Driveにはまだ反映されていない。

### Step 4. ファイルのリネーム・コピー保存(ローカルで実行)

```bash
python scripts/rename_and_save.py "/tmp/{案件コード}/entries.json" "/tmp/{案件コード}/receipt"
```

これにより `/tmp/{案件コード}/renamed/<勘定科目名>/<ファイル名>` が作成される
(ローカル版と同じ命名規則)。

### Step 5. Driveへの反映(アップロード・旧ファイルのtrash)

**5-1. receipt_filelist.xlsx の反映**

1. `/tmp/{案件コード}/receipt/receipt_filelist.xlsx` を `create_file` でreceiptフォルダ
   (`parentId = {receiptフォルダID}`)にアップロードする(新しいfileIdが発行される)。
2. アップロードが成功したことを確認してから、Step 1で取得した旧`receipt_filelist.xlsx`の
   fileIdを `trash_file` でゴミ箱へ移動する(**必ずアップロード成功後に行う**。
   逆順にするとアップロード失敗時にデータが失われる)。
   旧ファイルが存在しなかった場合(新規作成のケース)はこの手順は不要。

**5-2. renamedファイルの反映**

`/tmp/{案件コード}/renamed/` 配下の各ファイルについて、Drive上の対応する
`renamed/<勘定科目名>/` フォルダを `search_files` で探す(無ければ`create_file`で
`mimeType: application/vnd.google-apps.folder` を指定してフォルダを新規作成)。

- 同名ファイルがDrive上に既に存在する場合(Step 4のスクリプト側の「上書き」判定と同じ
  組み合わせ): 新規ファイルを `create_file` でアップロード後、旧ファイルを `trash_file`。
- 存在しない場合: そのまま `create_file` でアップロード。

**5-3. 後片付け**

`/tmp/{案件コード}/` 配下は一時作業ディレクトリなので、Step 5完了後に削除してよい
(次回実行時は Step 0 で作り直す)。

### Step 6. 報告

処理した件数と、それぞれの「対象月 / 取引先 / 日付 / 金額 / 区分 / 支払方法 / 保存先フォルダ」を
簡潔に報告する。対象月はStep 2で読み取った日付(西暦)から `YYYY年M月` の形式で算出する
(例: 日付が `2026-06-15` なら対象月は `2026年6月`)。仕訳データの作成はこのスキルでは
行わないため、必要であれば続けて `receipt-to-journal` スキルを使うようユーザーに伝える。

**履歴(TaskHistory)への反映**

ユーザーへの報告にあわせて、処理した関与先の履歴を1件更新する
(Step 1で新規ファイルが0件だった場合は行わない)。

1. `mcp__task-manager__list_history(client_code="{関与先コード}")` を呼び、
   `content` が `領収書の自動分類、リネーム保存` と一致するレコードが既にあるか確認する。
2. 見つかった場合: そのレコードの `historyId` を指定して
   `mcp__task-manager__update_history_entry` で更新する(重複登録せず、既存の1件を使い回す)。
3. 見つからない場合: `mcp__task-manager__create_history_entry` で新規に1件追加する。

いずれの場合も設定する値は以下で固定:

- 日付(date): 実行日(本日の日付、`YYYY-MM-DD`)
- 分類(category): `支払`
- タスク名(series_code): `処理登録`
- 担当者(assignee): `エージェント`
- ステータス(status): `進行中`
- 内容(content): `領収書の自動分類、リネーム保存`

**対象月(frame_codes)の反映**

対象月だけは固定値ではなく、今回処理した領収書の対象月に応じて都度セットする。

1. Step 2で読み取った日付から算出した対象月(`YYYY年M月`)を、
   `mcp__task-manager__list_frames` の `frameCode`(`YYYYMM`形式。例: `2026年6月` → `202606`)
   に変換する。今回処理した領収書が複数月にまたがる場合は、その全ての月をフレームコード化する。
2. 新規作成の場合: 変換した対象月のフレームコード一覧をそのまま `frame_codes` に設定する。
3. 更新の場合: 見つけた既存レコードが持つ対象月の一覧(`frameCodes`)を確認し、今回の対象月の
   うち既存の範囲に含まれていないものがあれば、既存の一覧にその不足分を追加した一覧を
   `frame_codes` に渡す(`update_history_entry` は指定したフィールドを丸ごと置き換えるため、
   既存分を含めずに渡すと過去の対象月が消えてしまう点に注意)。今回の対象月が既にすべて
   既存の範囲に含まれている場合は、`frame_codes` を指定しない(変更しない)。

複数の関与先をまとめて処理した場合は、関与先ごとにこの履歴更新も繰り返す。

## 補足

- `receipt_filelist.xlsx` のヘッダーは: No., ファイル名, 撮影日時, サイズ(MB), 種類, 日付, 金額,
  取引先, 内容, 区分, 支払方法, 消費税額, 仕訳No, 勘定科目名(ローカル版と同一)
- Google Driveの `create_file` は中身の上書き更新をサポートしないため、
  「新規作成 → 旧ファイルをtrash」で更新を表現する。これによりファイルIDは
  毎回変わるので、スキル側でIDをキャッシュせず、都度 `search_files` で
  `title` + `parentId` から検索し直すこと。
- `trash_file` は完全削除ではなくゴミ箱への移動(復元可能)。誤操作時の被害を抑えるため、
  常にこちらを使い、完全削除にあたる操作は行わない。
- 1領収書 = 1行が基本。1枚の領収書に複数の取引が混在する場合のみ複数行に分けてよい。
- 関与先ごとに `receipt_filelist.xlsx` も `renamed` フォルダも完全に独立している
  (他の関与先のデータと混ざることはない)。複数の関与先をまとめて処理してほしいと
  言われた場合は、関与先ごとに Step 0〜6 を繰り返す。
- Google Drive MCPツールの認証情報は、AWS Secrets Manager に保存した実ユーザーの
  Google OAuthリフレッシュトークン(環境変数 `GOOGLE_USER_TOKEN_SECRET_NAME` で指定、
  デフォルト `receipt-agent/google-drive-user-token`)から都度取得される
  (`agent_agentcore.py` の `_get_drive_service()` 参照)。ローカル版のような
  token.jsonファイルへの依存は無い。当初はAgentCore Identityの3LO(ユーザー委任)
  OAuthフローやサービスアカウント方式も検討したが、前者は既知の未解決バグ
  (awslabs/agentcore-samples#801、コールバックがauthorizationCode/stateを
  受け取れない)、後者はストレージクォータが無くアップロードに失敗するため、
  現在の方式に落ち着いている。
