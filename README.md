# taskmanager

DynamoDBベースのタスク管理システム。クライアント(Client) × シリーズ(Series、業務の種類) ×
フレーム(Frame、対象月)の組み合わせでタスクを管理し、Webアプリ(社内数名向け)とClaude(MCP)が
同じデータを共有する構成。加えて、クライアントごとの時系列ログを残す履歴機能と、Amazon Bedrock
AgentCore上の外部AIエージェントをWeb UIから呼び出す「エージェント」機能を持つ。詳しい設計判断の
経緯は [docs/設計書.md](docs/設計書.md) を参照。

バックエンドのLambda・Cognito・API GatewayをまとめたAWS SAMスタック名は`taskmanager`
(2026-08-01にリポジトリ名と揃える形で`task-mcp-server`から移行済み。個々のLambda関数名も
`taskmanager-mcp`/`taskmanager-api`/`taskmanager-agent-job-processor`に統一した)。

## ディレクトリ構成

```
taskmanager/
├── tables.yaml          DynamoDBテーブル(Tasks/TaskClients/TaskSeries/TaskFrames/TaskHistory/TaskAgentJobs)の単独スタック
├── template.yaml        Lambda(MCPサーバー + Web API + エージェントジョブ処理)+ Cognito + API Gateway
├── layer/
│   └── python/
│       └── task_repository.py   共通CRUDロジック(Lambda Layer)
├── mcp_src/
│   ├── app.py            MCPサーバー本体(FastMCP, Claude Desktop/claude.ai用)
│   └── requirements.txt
├── api_src/
│   └── app.py             Web API本体(API Gateway HTTP API用)
├── agent_job_src/
│   └── app.py             エージェントジョブ処理本体(Bedrock AgentCore呼び出し、API Gateway非経由の非同期Lambda)
├── skill/
│   └── SKILL.md          Claude Skill(gmail-todoの後継。メール連携部分の記述は要更新、docs/設計書.md 12章参照)
├── docs/
│   └── 設計書.md          詳細設計書(データモデル・意思決定の経緯・既知の課題)
└── README.md
```

## 構成

```
        DynamoDB(Tasks/TaskClients/TaskSeries/TaskFrames/TaskHistory/TaskAgentJobs)
            ┌────────────────┼────────────────┐
            │                                 │
      Web API (taskmanager-api)        MCPサーバー (taskmanager-mcp)
      API Gateway HTTP API                  Function URL
      + Cognito JWT認証                      │
            │                    ┌───────────┼───────────┐
      ブラウザ(社内数名)    Claude Desktop  claude.ai/   Claude Skill
            │                (mcp-remote)    Android等
            │ Event非同期invoke
            ▼
  エージェントジョブ処理 (task-agent-job-processor)
            │ invoke_agent_runtime
            ▼
  Amazon Bedrock AgentCore Runtime ──▶ Google Drive(receipt/renamedフォルダ)
```

3つのLambda(MCPサーバー・Web API・エージェントジョブ処理)は共通のLambda Layer(`task_repository`)を
参照し、CRUDロジックを一元管理する。エージェントジョブ処理LambdaのみAPI Gatewayの背後になく、
Web API LambdaからLambdaの`Event`非同期invocationで直接起動される(API Gatewayの30秒制限を超える
処理時間を扱うため。詳細は[docs/設計書.md](docs/設計書.md) 4-4章・9-7章参照)。

## デプロイ手順

### 1. DynamoDBテーブル(初回のみ)

```powershell
aws cloudformation deploy `
  --template-file tables.yaml `
  --stack-name task-tables `
  --region ap-northeast-1
```

`Tasks`/`TaskClients`/`TaskSeries`/`TaskFrames`/`TaskHistory`/`TaskAgentJobs`の6テーブルが作成される。

### 2. Lambda(MCPサーバー + Web API + エージェントジョブ処理 + Cognito)

```powershell
sam build --use-container
sam deploy --guided
```

`--use-container`は必須。コンテナなしでネイティブビルドすると、`mcp`パッケージが持つ
Windows専用の条件付き依存(`pywin32`)をLambdaのLinuxランタイム向けに解決できず失敗する。

社内ネットワークでSSL検査(アンチウイルス等によるHTTPS通信のMITM検査)が行われている環境では、
コンテナ内の`pip`がPyPIへのSSL検証に失敗することがある。その場合は以下のようなJSONファイルを用意し、
`--container-env-var-file`で読み込ませることで回避できる(該当ホストのSSL検証のみをスキップする):

```json
{
  "Parameters": {
    "PIP_TRUSTED_HOST": "pypi.org files.pythonhosted.org pypi.python.org"
  }
}
```

```powershell
sam build --use-container --container-env-var-file pip-trusted-host.json
```

初回の`--guided`で以下を入力:

| 項目 | 値 |
|---|---|
| Stack Name | `taskmanager` |
| AWS Region | `ap-northeast-1` |
| Parameter McpAuthToken | (推測されにくいランダム文字列) |
| Parameter AgentRuntimeArn | 領収書分類エージェントのBedrock AgentCore Runtime ARN(デフォルト値あり。別スタックで管理されている既存のAgentCore Runtimeを指定する) |
| Confirm changes before deploy | Y |
| Allow SAM CLI IAM role creation | Y |
| TaskMcpFunction may not have authorization defined, Is this okay? | Y(Function URL自体はAuthType: NONEだが、app.py内でBearerトークン/Anthropic IPによるアクセス制御を行っている) |
| Save arguments to configuration file | Y |

デプロイ後の`Outputs`に以下が表示される:

- `TaskMcpFunctionUrl` — Claude Desktop/claude.aiのMCP設定に登録するURL
- `WebApiEndpoint` — フロントエンドが呼び出すAPIのベースURL
- `UserPoolId` / `UserPoolClientId` — フロントエンドのAmplify設定、および管理者によるユーザー作成に使用

> **注意**: `TaskAgentJobProcessorFunction`は`bedrock-agentcore:InvokeAgentRuntime`をベースの
> `AgentRuntimeArn`と`${AgentRuntimeArn}/runtime-endpoint/*`の両方に許可するIAMポリシーを持つ
> (実際の認可チェックは`runtime-endpoint`配下のARNに対して行われるため、ベースARNのみでは
> `AccessDeniedException`になる)。`AgentRuntimeArn`を別の値に差し替える場合、対象のAgentCore
> Runtimeが実際にデプロイ・有効化されていることを事前に確認すること。

## Cognitoユーザーの作成(管理者作業)

セルフサインアップは無効化してある(`AllowAdminCreateUserOnly: true`)。社内スタッフのアカウントは管理者が作成する。

```powershell
aws cognito-idp admin-create-user `
  --user-pool-id <UserPoolId> `
  --username takamura@example.com `
  --user-attributes Name=email,Value=takamura@example.com Name=email_verified,Value=true `
  --region ap-northeast-1
```

初回ログイン時に仮パスワードの変更を求められる。

## Web API エンドポイント一覧

| Method | Path | 用途 |
|---|---|---|
| GET | `/clients` | 登録済み全クライアント一覧(クライアント選択ドロップダウン用) |
| POST | `/clients` | クライアント新規登録(既存`clientCode`の場合は409。`receiptFolderId`/`renamedFolderId`/`assignee`/`fiscalYearEndMonth`/`threeMonthsAfterMonth`/`interimMonth`/`nineMonthsAfterMonth`を任意指定可) |
| PATCH | `/clients/{clientCode}` | クライアント名・Driveフォルダ設定・担当者・決算月・中間月の更新(未存在なら404) |
| DELETE | `/clients/{clientCode}` | クライアント削除 |
| GET | `/series` | 登録済み全シリーズ一覧(タスク作成時のドロップダウン用) |
| POST | `/series` | シリーズ新規登録(既存`seriesCode`の場合は409。`taskGroup`を任意指定可) |
| DELETE | `/series/{seriesCode}` | シリーズ削除 |
| GET | `/frames` | 登録済み全フレーム一覧(時系列順) |
| POST | `/frames` | フレーム新規登録(既存`frameCode`の場合は409) |
| DELETE | `/frames/{frameCode}` | フレーム削除 |
| GET | `/clients/{clientCode}/tasks` | 指定クライアントのタスク一覧(シリーズ→フレーム順) |
| GET | `/tasks/{clientCode}/{seriesCode}/{frameCode}` | タスク詳細1件 |
| POST | `/tasks` | 新規タスク作成(Series/Frameが未登録なら自動登録) |
| PATCH | `/tasks/{clientCode}/{seriesCode}/{frameCode}` | ステータス・担当者・完了日の更新 |
| GET | `/clients/{clientCode}/history` | 指定クライアントの履歴一覧(分類→日付順) |
| POST | `/clients/{clientCode}/history` | 履歴エントリ新規追加(`date`必須) |
| PATCH | `/clients/{clientCode}/history/{historyId}` | 履歴エントリの更新(未存在なら404) |
| DELETE | `/clients/{clientCode}/history/{historyId}` | 履歴エントリの削除 |
| POST | `/clients/{clientCode}/agent-jobs` | エージェントジョブの起動(202を返し、`task-agent-job-processor`をEvent非同期invoke) |
| GET | `/clients/{clientCode}/agent-jobs/{jobId}` | エージェントジョブの状態取得(ポーリング用) |

全エンドポイントは`Authorization: Bearer <Cognito IDトークン>`が必須(`DefaultAuthorizer: CognitoAuth`)。

`clientCode`/`seriesCode`/`frameCode`/`historyId`/`jobId`をURLパスに埋め込む際は、フロントエンド側で`encodeURIComponent`必須。

CSVアップロード専用のバックエンドエンドポイントは存在しない。フロントエンド(`HistoryPanel.jsx`)が
CSVを自前パースし、行ごとに`POST /clients/{clientCode}/history`を逐次呼び出す(詳細は
[docs/設計書.md](docs/設計書.md) 4-5章)。

## Claude Desktop / Claude Code への登録(MCPサーバー)

`claude_desktop_config.json`に追加(`mcp-remote`をstdioブリッジとして利用):

```json
{
  "mcpServers": {
    "task-manager": {
      "command": "C:\\nvm4w\\nodejs\\mcp-remote.cmd",
      "args": [
        "https://xxxxxxxx.lambda-url.ap-northeast-1.on.aws/",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": {
        "AUTH_HEADER": "Bearer <McpAuthTokenパラメータに指定した値>"
      }
    }
  }
}
```

注意点:
- `command`はnpmグローバルインストール先のフルパスを指定すること(`npx`経由だと解決待ちでタイムアウトする場合がある)
- 環境によってはNode.jsの`fetch`がTLS証明書チェーンを検証できない場合があり、`env`に`"NODE_TLS_REJECT_UNAUTHORIZED": "0"`の追加が必要になることがある

MCPツールとして公開されているのは`list_clients`/`create_client`/`list_series`/`list_frames`/
`list_tasks_by_client`/`get_task`/`create_task`/`update_task`/`list_history`/`create_history_entry`/
`update_history_entry`の11個。クライアント/シリーズ/フレームの削除、履歴の削除、エージェント機能は
Web UI専用でMCP経由では利用できない(詳細は[docs/設計書.md](docs/設計書.md) 6-2章)。

## claude.ai / モバイル(カスタムコネクタ)での利用

claude.ai → Customize → Connectors → Add custom connector で、上記Function URLを登録するだけでよい
(OAuth設定は不要。Anthropicの公開アウトバウンドIPレンジからのアクセスをapp.py側で許可しているため)。

## Skill の配置

```
skill/SKILL.md
```

を Claude Desktop のカスタムSkillディレクトリに配置する。旧 `gmail-todo` skillは本skillに統合されたため、
混在運用する場合は片方を無効化すること。

## email_router.py との連携

既存の `email_router.py` の `[依頼]` ハンドラから、Claude APIへのリクエスト時に
本MCPサーバーをツールとして渡す(MCP Connector経由)ことで、メール検知 → タスク自動登録の
フローが実現できる。具体的な統合コードは既存の `email_router.py` の構成に依存するため、別途すり合わせが必要。

> **注意**: Gmailスレッドをタスクに直接紐付ける`link_email`ツール(旧`POST /tasks/{taskId}/emails`)は
> ドメインモデルの再設計(docs/設計書.md 参照)により廃止した。`email_router.py`側でメール検知からの
> タスク自動登録自体は引き続き`create_task`ツール経由で可能だが、スレッドIDをタスクに保持する機能は
> 現在ないため、連携仕様の見直しが必要。

## エージェント機能(Bedrock AgentCore連携)

Web UIの「エージェント」タブから、Amazon Bedrock AgentCore上で動く外部AIエージェントを呼び出せる。
現時点で実装されているのは、クライアントのGoogle Drive上の`receiptFolderId`フォルダにある領収書
画像を勘定科目ごとにリネーム・分類する「分類」(`archivist`)エージェントの1つのみ(他4種はUIのみ
先行して用意されたプレースホルダで、起動ボタンは無効化されている)。

- クライアントマスタ(`ClientListPage.jsx`)で`receiptFolderId`(入力用)/`renamedFolderId`(出力用)の
  Google DriveフォルダIDを設定しておくと、エージェント起動時のプロンプトに自動で埋め込まれる。
- 実行状態は`processing`→`completed`/`error`で`TaskAgentJobs`テーブルに記録され、フロントエンドが
  3秒間隔・最大100回(約5分)ポーリングして結果を表示する。ジョブレコードはTTLで1日後に自動削除される。
- 処理の詳細な設計判断(非同期2段構成にした理由、二重実行防止のclaim機構、タイムアウト設定等)は
  [docs/設計書.md](docs/設計書.md) 4-4章・9-7〜9-9章を参照。

## フロントエンド(React + Amplify Hosting)

`frontend/` 配下にReactアプリ本体がある。

```
frontend/
├── src/
│   ├── config.js              Cognito User Pool / API エンドポイントの設定(sam deploy後に値を反映)
│   ├── api.js                  APIクライアント(Cognitoトークン自動添付、UTF-8明示エンコード、19関数)
│   ├── main.jsx                 Amplify設定 + ログイン画面(Authenticator、日本語UIラベル)
│   ├── App.jsx                  ルートコンポーネント(ハンバーガーメニューによる画面切り替え+パネル内タブ切り替え)
│   ├── NavMenu.jsx              ハンバーガーメニュー(コンソール/クライアント/タスクシリーズ/フレーム)
│   ├── ClientListPage.jsx      関与先マスタの一覧(関与先番号/関与先名/担当者/決算月)・新規作成(関与先名クリックでClientProfilePageへ)
│   ├── ClientProfilePage.jsx   関与先のプロフィール編集(項目名:値の縦並び。関与先番号/関与先名/担当者/決算月/3か月後月/中間月/9か月後月/領収書フォルダ/分類後フォルダ、削除ボタンも配置)
│   ├── SeriesListPage.jsx      シリーズ(表示名「タスク」)マスタの一覧・編集・新規作成・削除
│   ├── FrameListPage.jsx       フレーム(表示名「月」)マスタの一覧・編集・新規作成・削除
│   ├── ClientSelector.jsx      パネルヘッダー内のクライアント選択ドロップダウン
│   ├── ProgressTable.jsx        進捗表(ピボットテーブル、資料進捗タブのデフォルト表示)
│   ├── TaskTable.jsx            タスク一覧のフラット表示テーブル
│   ├── TaskDetailPanel.jsx      タスク選択時に開く右側詳細パネル
│   ├── NewTaskForm.jsx          既存シリーズの全登録フレーム分タスクを一括作成するフォーム
│   ├── StatusSelect.jsx        ステータス(未着手/依頼中/確認中/進行中/完了/-、6段階)のドロップダウン
│   ├── HistoryPanel.jsx         履歴タブ(インライン編集+新規追加+CSVアップロード)
│   └── AgentsPanel.jsx          エージェントタブ(ジョブ発行・ポーリング・結果表示)
├── amplify.yml                  (リポジトリルートに配置。モノレポ形式でappRoot: frontendを指定)
└── package.json
```

コンポーネント構成・状態管理・画面遷移の詳細は[docs/設計書.md](docs/設計書.md) 7章を参照。

### デザインの方針

社内のタックス事務所向け業務ツールという位置付けのため、一般的なSaaS風のデザインではなく、
台帳・帳簿をモチーフにした落ち着いた配色とタイポグラフィを採用している。ステータスは
日本の業務文書になじみのある「印影(はんこ)」風の見た目を保ちつつ、6段階の値を
ドロップダウンで自由に選択できる。

### 1. 設定値の反映

`sam deploy`実行後に表示される`Outputs`の値を`src/config.js`に反映する
(現状すでに直近のデプロイ結果で設定済み)。

```js
export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: "<UserPoolId>",
      userPoolClientId: "<UserPoolClientId>",
    },
  },
};
export const API_BASE_URL = "<WebApiEndpoint>";
```

### 2. ローカルでの動作確認

```powershell
cd frontend
npm install
npm run dev
```

`http://localhost:5173`にアクセスし、Cognitoユーザー(管理者が作成したアカウント)でログインする。

### 3. Amplify Hostingへのデプロイ(GitHub連携)

1. GitHubに本リポジトリをpush(プライベートリポジトリ推奨。社内業務データを扱うため)
2. Amplify Hosting コンソール → 新しいアプリ → GitHubを選択して連携
3. リポジトリ・ブランチを選択
4. **モノレポ構成のため、`amplify.yml`はリポジトリのルートに配置**してある
   (`applications`キーで`appRoot: frontend`を指定する形式。`frontend/`配下に単純な`amplify.yml`を
   置くと「アプリのルートディレクトリ」設定との不整合で`Monorepo spec provided without "applications" key`
   エラーになるため、必ずルート直下のものを使うこと)
5. ビルド設定が自動検出されることを確認し、「保存してデプロイ」
6. `main`ブランチへのpushのたびに自動ビルド・デプロイされる

### 4. 本番運用前の注意

- `template.yaml`の`HttpApi.CorsConfiguration.AllowOrigins`を`"*"`から、Amplify Hostingの実際のドメインに限定すること
- Cognitoユーザーは管理者が`admin-create-user`で作成する運用(セルフサインアップは無効化済み)

## 未実装・今後の検討事項

- `skill/SKILL.md` / `skill/bpo-task-manager/SKILL.md`のメール連携に関する記述の見直し(`link_email`廃止に伴う)
- 他人の更新をリアルタイムにプッシュする仕組み(DynamoDB Streams + AppSync、またはWebSocket API) — 現状はポーリング想定
- 本番運用前にAPI GatewayのCORS設定(`AllowOrigins`)をAmplify Hostingのドメインのみに限定する
- ロールベースのアクセス制御(RBAC)の導入検討 — 現状は認証済みユーザー全員が同じ権限。エージェント機能も含め区別なし
- CSVアップロードの列⇔項目マッピング精緻化 — 現状は各行を丸ごと`content`に詰めるだけの暫定実装
- エージェントカタログ中3/5(`scout`/`courier`/`auditor`)が未実装のプレースホルダ

詳しい設計判断の経緯・データモデルの詳細・既知の課題一覧は [docs/設計書.md](docs/設計書.md) を参照。
