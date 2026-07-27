# task-mcp-server

DynamoDBベースのタスク管理システム。クライアント(Client) × シリーズ(Series、業務の種類) ×
フレーム(Frame、対象月)の組み合わせでタスクを管理し、Webアプリ(社内数名向け)とClaude(MCP)が
同じデータを共有する構成。詳しい設計判断の経緯は [docs/設計書.md](docs/設計書.md) を参照。

## ディレクトリ構成

```
task-mcp-server/
├── tables.yaml          DynamoDBテーブル(Tasks/TaskClients/TaskSeries/TaskFrames)の単独スタック
├── template.yaml        Lambda(MCPサーバー + Web API)+ Cognito + API Gateway
├── layer/
│   └── python/
│       └── task_repository.py   共通CRUDロジック(Lambda Layer)
├── src/
│   ├── app.py            MCPサーバー本体(FastMCP, Claude Desktop/claude.ai用)
│   └── requirements.txt
├── api_src/
│   └── app.py             Web API本体(API Gateway HTTP API用)
├── skill/
│   └── SKILL.md          Claude Skill(gmail-todoの後継。メール連携部分の記述は要更新、docs/設計書.md 12章参照)
└── README.md
```

## 構成

```
              DynamoDB(Tasks/TaskClients/TaskSeries/TaskFrames)
            ┌────────────────┼────────────────┐
            │                                 │
      Web API (task-api)              MCPサーバー (task-mcp-server)
      API Gateway HTTP API                  Function URL
      + Cognito JWT認証                      │
            │                    ┌───────────┼───────────┐
      ブラウザ(社内数名)    Claude Desktop  claude.ai/   Claude Skill
                            (mcp-remote)    Android等
```

両Lambdaは共通のLambda Layer(`task_repository`)を参照し、CRUDロジックを一元管理する。

## デプロイ手順

### 1. DynamoDBテーブル(初回のみ)

```powershell
aws cloudformation deploy `
  --template-file tables.yaml `
  --stack-name task-tables `
  --region ap-northeast-1
```

### 2. Lambda(MCPサーバー + Web API + Cognito)

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
| Stack Name | `task-mcp-server` |
| AWS Region | `ap-northeast-1` |
| Parameter McpAuthToken | (推測されにくいランダム文字列) |
| Confirm changes before deploy | Y |
| Allow SAM CLI IAM role creation | Y |
| TaskMcpFunction may not have authorization defined, Is this okay? | Y(Function URL自体はAuthType: NONEだが、app.py内でBearerトークン/Anthropic IPによるアクセス制御を行っている) |
| Save arguments to configuration file | Y |

デプロイ後の`Outputs`に以下が表示される:

- `TaskMcpFunctionUrl` — Claude Desktop/claude.aiのMCP設定に登録するURL
- `WebApiEndpoint` — フロントエンドが呼び出すAPIのベースURL
- `UserPoolId` / `UserPoolClientId` — フロントエンドのAmplify設定、および管理者によるユーザー作成に使用

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
| POST | `/clients` | クライアント新規登録(既存`clientCode`の場合は409) |
| GET | `/series` | 登録済み全シリーズ一覧(タスク作成時のドロップダウン用) |
| GET | `/frames` | 登録済み全フレーム一覧(時系列順) |
| GET | `/clients/{clientCode}/tasks` | 指定クライアントのタスク一覧(シリーズ→フレーム順) |
| GET | `/tasks/{clientCode}/{seriesCode}/{frameCode}` | タスク詳細1件 |
| POST | `/tasks` | 新規タスク作成(Series/Frameが未登録なら自動登録) |
| PATCH | `/tasks/{clientCode}/{seriesCode}/{frameCode}` | ステータス・担当者・完了日の更新 |

全エンドポイントは`Authorization: Bearer <Cognito IDトークン>`が必須(`DefaultAuthorizer: CognitoAuth`)。

`clientCode`/`seriesCode`/`frameCode`をURLパスに埋め込む際は、フロントエンド側で`encodeURIComponent`必須。

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

## フロントエンド(React + Amplify Hosting)

`frontend/` 配下にReactアプリ本体がある。

```
frontend/
├── src/
│   ├── config.js            Cognito User Pool / API エンドポイントの設定(sam deploy後に値を反映)
│   ├── api.js                APIクライアント(Cognitoトークン自動添付、UTF-8明示エンコード)
│   ├── App.jsx                クライアント選択 → タスク一覧 → 新規作成のメインフロー
│   ├── ClientSelector.jsx    クライアント一覧からのオートコンプリート選択+新規登録
│   ├── TaskTable.jsx          タスク一覧(シリーズ/フレーム表示、担当はインライン編集)
│   ├── StatusSelect.jsx      ステータス(未着手/進行中/完了)のドロップダウン
│   ├── NewTaskForm.jsx        新規タスク作成フォーム(Series/Frameドロップダウン+インライン新規登録)
│   └── main.jsx                Amplify設定 + ログイン画面(Authenticator)
├── amplify.yml                (リポジトリルートに配置。モノレポ形式でappRoot: frontendを指定)
└── package.json
```

### デザインの方針

社内のタックス事務所向け業務ツールという位置付けのため、一般的なSaaS風のデザインではなく、
台帳・帳簿をモチーフにした落ち着いた配色とタイポグラフィを採用している。ステータスは
日本の業務文書になじみのある「印影(はんこ)」風の見た目を保ちつつ、未着手/進行中/完了を
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
- ロールベースのアクセス制御(RBAC)の導入検討 — 現状は認証済みユーザー全員が同じ権限

詳しい設計判断の経緯・データモデルの詳細は [docs/設計書.md](docs/設計書.md) を参照。
