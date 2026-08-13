---
name: email-summary
description: |
  Gmailの新着受信メールを要約し、差出人・転送/返信元の差出人・宛先のメールアドレスから
  関与先(client_code)を判定して、taskmanagerの履歴(TaskHistory)に記録するスキル
  (AgentCore版)。添付ファイルがあれば、判定した関与先のGoogle Driveの受領フォルダ
  (uketoriFolderId)へ保存する。「メールを要約して履歴に保存して」「新着メールを
  処理して」「メール履歴を更新して」「(関与先名)の新着メールを処理して」のように
  言われたら、または定期実行(スケジュール)で呼ばれたら必ずこのスキルを使うこと。
  何度でも再実行できるよう、処理済みメールには
  Gmailラベル「エージェント処理済」を付けて自動でスキップする。領収書のOCR・リネームは
  行わない(それはreceipt-ocr-filelistスキルの役割)。
---

# メール要約 → 履歴保存 → 添付ファイルDrive保存(AgentCore版)

Gmail上の新着受信メールを要約し、関与先(JKL/MAX/AMR/IKK/JLR等)を判定した上で、
taskmanagerの履歴に1件ずつ記録する。添付ファイルがあれば、判定した関与先の
Google Drive「受領フォルダ」へ保存する。定期ポーリング(スケジュール実行)を
前提とし、処理済みメールにはGmailラベル「エージェント処理済」を付けて重複処理を防ぐ。

このスキルは `mcp__gmail__*`(list_labels / create_label / search_threads /
get_message / get_attachment / label_message)、`mcp__google-drive__create_file`、
`mcp__task-manager__list_clients` / `mcp__task-manager__list_series` /
`mcp__task-manager__create_history_entry` を組み合わせて動く。

## MCPツール名について(実行環境による違い)

本文中の `mcp__gmail__...` / `mcp__google-drive__...` / `mcp__task-manager__...` は
AgentCore環境でのツール名。別の実行環境では異なるプレフィックスで登録されている
ことがある。その名前のツールが見つからない場合、それだけで「利用できない」と
判断してはいけない。まずそのままの名前で呼び出しを試し、見つからなければツール
検索の仕組みでキーワード検索を行い、この環境での実際のツール名を特定してから
使うこと。それでも見つからない場合に限り、ユーザーに報告する。

## 関与先設定はtaskmanagerクライアントマスタから取得する

差出人メールアドレス・添付保存先フォルダIDはハードコードせず、
`mcp__task-manager__list_clients` で取得したクライアントマスタの以下フィールドを
毎回参照する。

- `clientCode` / `clientName`
- `senderEmails`(この関与先宛と判定するメールアドレスの配列。1つの関与先に
  複数登録できる。未設定の関与先もある)
- `uketoriFolderId`(添付ファイルの保存先。関与先フォルダ直下の「受領フォルダ」。未設定の場合は添付保存をスキップ)

`senderEmails` は完全一致(大文字小文字は区別しない)で照合する。ドメイン単位の
判定は行わない。同じメールアドレスが複数の関与先に登録されることは無い前提とし、
このスキル側で重複登録の解決は行わない(重複が見つかった場合はStep 6で報告する)。

`senderEmails` が空の関与先、またはどの関与先のメールアドレスにも一致しないメールは
`client_code = "未分類"` として扱う(添付ファイルは保存しない)。taskmanagerに
`未分類` クライアントが無い場合は、履歴記録をスキップしてその旨をStep 6で報告する
(このスキールはクライアント新規登録を行わない)。

## 対象関与先の指定(任意)

プロンプトに関与先コード(例:「IKKの新着メールを処理して」)が含まれる場合は、
その関与先だけを対象にスコープを絞る(taskmanagerのエージェントタブから、
特定クライアントを選んで起動されるケース)。含まれない場合(定期実行トリガー等)は
受信トレイ全体を対象にする。

- 関与先が指定された場合:Step 0で取得した対応表からその関与先の`senderEmails`を
  引き、Step 1の検索クエリを `label:inbox -label:エージェント処理済 (from:email1 OR
  to:email1 OR from:email2 OR ...)` のように絞り込む(`senderEmails`が
  複数ある場合はOR条件で並べる)。ただし転送・返信元の差出人がこのアドレスである
  ケース(Step 2の判定2)は件名・本文を読まないと分からないため、直近差出人・宛先が
  他アドレスでも一致する可能性のあるメールを取りこぼすことがある点に注意
  (定期実行(全件スキャン)の方が判定精度は高い)
- 指定が無い場合:Step 1は `label:inbox -label:エージェント処理済` のまま(全件対象)

## 全体の流れ

### Step 0. 関与先設定・シリーズコード・前回処理位置の確認

1. `mcp__task-manager__list_clients` を呼び、`clientCode → {senderEmails, uketoriFolderId}`
   の対応表をメモリ上に作る(このスキル実行中はこの表を使い回し、都度問い合わせない)。
2. `mcp__task-manager__list_series` を呼び、`taskGroup`(=分類/category)が `"支払"`
   かつ `seriesName`(=シリーズ名)が `"資料受領"` である項目を探し、その `seriesCode`
   をStep 3で使う「資料受領」の `series_code` として控える(このスキル実行中は
   使い回し、都度問い合わせない)。該当するシリーズが見つからない場合は、
   履歴記録を行わずその旨をStep 6で報告する。
3. `mcp__gmail__list_labels` で `エージェント処理済` ラベルの有無を確認し、無ければ
   `mcp__gmail__create_label` で作成する。

### Step 1. 新着メールの取得

`mcp__gmail__search_threads` で `エージェント処理済` ラベルが付いていない受信メールを検索する。

```
query: label:inbox -label:エージェント処理済
```

該当が0件なら「新着メールはありません」と報告して終了する。

### Step 2. 関与先判定・要約・添付有無の確認

各メールについて `mcp__gmail__get_message` で headers(From/To/Cc)・本文
(bodyText)・添付一覧(attachments)を取得し、以下の順で `client_code` を判定する。
いずれの照合も、メールアドレス全体をStep 0の `senderEmails` 対応表と完全一致
(大文字小文字を区別しない)で比較する。ドメイン部分だけの一致では判定しない。

1. **直近の差出人(From)のメールアドレス**を `senderEmails` 対応表と照合する
2. 一致しなければ、**転送・返信元の差出人のメールアドレス**を調べる。`bodyText` 中に
   引用された元メールのヘッダー(「From:」「差出人:」「-------- Forwarded
   message --------」「On ... wrote:」等の引用ブロック)がある場合、そこに
   記載された元の差出人メールアドレスを抽出し、同様に照合する
   (引用が多重(転送の転送等)の場合は、本文中に出てくる差出人メールアドレスを
   すべて拾って照合する)
3. それでも一致しなければ、**宛先(To/Cc)のメールアドレス**を
   同じ対応表と照合する
4. 上記いずれにも一致しなければ「未分類」とする

複数の判定ステップで異なる関与先に一致した場合は、直近の差出人(ステップ1)を
優先する。判定に使った根拠(差出人/転送元/宛先のどれで一致したか)は、Step 3の
`content` に一言添える。

- `bodyText` を2〜3行に要約する
- `attachments` の有無を確認する(あればファイル名一覧を控える)

### Step 3. 履歴への記録

判定した `client_code` ごとに `mcp__task-manager__create_history_entry` を呼ぶ
(未分類の場合はStep 6の報告のみでスキップする)。

```
client_code: {判定結果}
date: {メールのDateヘッダーから得た受信日, YYYY-MM-DD}
category: "支払"
series_code: {Step 0で控えた、category="支払"・series="資料受領"に一致するseriesCode}
frame_codes: [{受信月, YYYYMM}]
assignee: "資料整理君"
status: "未着手"
content: {Step2で作成した要約}
  (判定根拠を付記。添付があれば末尾に「添付: ファイル名」も付記)
```

### Step 4. 添付ファイルの保存

添付があり、かつ関与先が判定できていて `uketoriFolderId` が設定されている場合
のみ、各添付を以下の手順で保存する。

1. `mcp__gmail__get_attachment(message_id, attachment_id, save_path="/tmp/{client_code}/mail/{filename}")`
   でローカルに保存
2. `mcp__google-drive__create_file(local_path, name=filename, parent_id={uketoriFolderId}, mime_type)`
   でDriveの受領フォルダへアップロード

「未分類」の場合や `uketoriFolderId` が未設定の場合は添付保存をスキップし、
その旨をStep 3の `content` に明記する。

### Step 5. 処理済みマーク

Step 3〜4が成功したメールに `mcp__gmail__label_message` で `エージェント処理済` ラベルを
付与する(失敗したメールには付けず、次回再試行の対象として残す)。

### Step 6. 報告

処理件数、関与先ごとの内訳(件数)、添付保存件数、未分類件数(未分類は履歴未記録
である旨も)を簡潔に報告する。

## 補足

- Gmail・Google Driveの認証情報は、同一のGoogle OAuthリフレッシュトークン
  (Secrets Manager、Driveスコープ+Gmail読み取り/ラベル管理スコープ)を共有する。
- 1メール = 履歴1件が基本。スレッド内の複数メールも個別に記録する。
- 差出人メールアドレス・受領フォルダIDの追加・変更は、taskmanagerのクライアント設定
  (フロントエンドのクライアントプロフィール画面、または `update_client`)で行う。
  このスキル自体は改修不要。
- クライアントマスタのフィールド名は `senderEmails`(メールアドレス配列)。
  `api_src/app.py`・`layer/python/task_repository.py`・
  `frontend/src/ClientProfilePage.jsx`(プロフィール画面の「差出人メールアドレス」欄)
  も同名で対応済み。
- 送信(メール送信)・完全削除は一切行わない(付与するGmailスコープはreadonlyと
  modifyのみで、送信・削除権限を持たない)。
