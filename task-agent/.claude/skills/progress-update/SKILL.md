---
name: progress-update
description: |
  taskmanagerの履歴(TaskHistory)エントリのうち、タスク名(seriesCode)・対象月(frameCodes)・
  ステータス(status)の3項目が入力済みのものについて、対応するTask(clientCode+seriesCode+
  frameCodeで一意に決まる進捗レコード)のstatusへ反映する。Web UIの履歴パネルにある
  「進捗反映」ボタン(HistoryPanel.jsxのreflectProgress)が1件ずつ手動で行っている処理を、
  履歴に溜まった複数件についてまとめて自動実行するもの。
  「進捗を更新して」「履歴を整理して」「MMの進捗を更新して」「履歴の内容をタスクに反映して」の
  ように言われたら必ずこのスキルを使うこと。使用時は最初に必ずどの関与先(案件コード)を
  処理するか確認してから、mcp__task-manager__list_history で該当関与先の履歴を取得すること。
  領収書のOCR・リネームは行わない(それは receipt-ocr-filelist スキルの役割)。履歴自体の
  日付・分類・担当者・内容欄の穴埋めは行わない(以前のバージョンはcontentから4項目を
  解釈・穴埋めしていたが、現在はTask側への反映のみを行う)。
---

# 履歴の進捗反映(AgentCore版)

taskmanagerの履歴(TaskHistory)のうち、タスク名(seriesCode)・対象月(frameCodes)・
ステータス(status)が入力済みのレコードについて、そのSeries×Frameの組み合わせに対応する
Task(clientCode+seriesCode+frameCodeで一意に決まる進捗レコード)のstatusを、履歴と同じ
値へ更新するスキル。Web UIの履歴パネル(`HistoryPanel.jsx`)の「進捗反映」ボタンが1件ずつ
手動で行っている処理を、履歴に溜まった複数件についてまとめて実行する。

このスキルは `mcp__task-manager__list_history` / `mcp__task-manager__update_task`
(taskmanagerのTaskHistory/Tasksテーブルを操作するMCPツール)のみを使う。TaskHistory自体の
date/category/assignee/contentは一切書き換えない。Google Driveやレシート処理には関与しない。

## MCPツール名について(実行環境による違い)

本文中の `mcp__task-manager__...` はAgentCore環境でのツール名。Claude Codeの
claude.aiコネクタ経由など、別の実行環境では同じtaskmanager MCPサーバーが異なる
プレフィックス(例: `mcp__claude_ai_taskmanager-mcp__...`)で登録されていることがある。
その名前のツールが見つからない場合、それだけで「利用できない」と判断して処理を
スキップしてはいけない。まずそのままの名前で呼び出しを試し、見つからなければ
ツール検索の仕組み(例: `ToolSearch`)で `"taskmanager list_history update_task list_clients"`
のようなキーワード検索を行い、この環境での実際のツール名を特定してから使うこと。
それでも見つからない場合に限り、ユーザーに報告する。

## Step 0. 関与先の確認

プロンプトに関与先コードが含まれていなければ、`mcp__task-manager__list_clients` で
候補を取得し、ユーザーにどの関与先(案件)を処理するか確認する。

## Step 1. 履歴レコードの取得

```
mcp__task-manager__list_history(client_code="{関与先コード}")
```

返るレコードは `historyId, date, category, seriesCode, frameCodes, assignee, status,
content, createdAt, updatedAt` を持つ。

## Step 2. 反映対象の絞り込み

`seriesCode` が空でなく、`frameCodes` が1件以上あり、`status` が空文字でないレコードだけを
反映対象とする。いずれか欠けているレコードは、対応するTaskを特定できない(seriesCode/
frameCodesが無い)か、どのステータスを反映すべきか不明(statusが無い)なため、対象外として
スキップする(Step 4で件数のみ報告し、TaskHistory自体は変更しない)。

対象が0件なら「進捗反映の対象となる履歴はありません」と報告して終了する。

## Step 3. Taskへの反映

対象レコードそれぞれについて、`frameCodes` に含まれる `frameCode` ごとに1回、
`mcp__task-manager__update_task` を呼び出す。

```
mcp__task-manager__update_task(
    client_code="{関与先コード}",
    series_code="{そのレコードのseriesCode}",
    frame_code="{frameCodesの各要素}",
    status="{そのレコードのstatus}",
)
```

1件の履歴レコードに`frameCodes`が複数含まれる場合、対象となる全`frameCode`に対して同じ
`status`を反映する(Web UIの「進捗反映」ボタンと同じ挙動)。

対応するTaskがまだ作成されていない場合(TaskNotFoundError)は、そのTaskだけ失敗として
記録し、他のレコード・他の`frameCode`の処理は続行する。**Taskを新規作成することはしない**
(Taskの新規作成はTask一覧画面/`create_task`の役割であり、このスキルは既存Taskの
ステータス更新のみを行う)。

## Step 4. 報告

- 反映対象とした履歴レコード件数
- 反映に成功したTask件数
- 反映に失敗したTask件数(TaskNotFoundErrorなど、原因も添えて)
- Step 2で対象外としてスキップした履歴レコード件数

を簡潔に報告する。

## 補足

- 何度再実行しても安全(`update_task`は指定した`status`で単純に上書きするだけの冪等な操作)。
  同じ内容の履歴が複数回処理されても、Task側は同じ`status`に落ち着くだけで実害はない。
  そのため「前回反映済みかどうか」を判定する処理は行わず、対象条件(Step 2)を満たす履歴は
  毎回すべて反映し直してよい。
- 履歴自体の`date`/`category`/`assignee`/`content`は一切変更しない。日付・分類・担当者の
  解釈・穴埋めはこのスキルの役割ではない(以前のバージョンとの違い)。
- 1件の履歴に複数の`frameCode`が紐づいていても、履歴レコード自体を分割・統合したりは
  しない。反映先のTaskが複数に分かれるだけで、履歴は1件のまま扱う。
- 関与先ごとに履歴・タスクは完全に独立している。複数の関与先をまとめて処理してほしいと
  言われた場合は、関与先ごとにStep 0〜4を繰り返す。
