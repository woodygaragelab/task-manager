# task-mcp-server

DynamoDBベースのタスク管理システム。Webアプリ(社内数名向け)とClaude Skill(メールトリガー含む)が
同じデータを共有する構成。

## ディレクトリ構成

```
task-mcp-server/
├── tables.yaml          DynamoDBテーブル(Tasks/TaskCases/TaskCounters)の単独スタック
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
│   └── SKILL.md          Claude Skill(gmail-todoの後継)
└── README.md
```

## 構成

```
                    DynamoDB(Tasks/TaskCases/TaskCounters)
            ┌────────────────┼────────────────┐
            │                                 │
      Web API (task-api)              MCPサーバー (task-mcp-server)
      API Gateway HTTP API                  Function URL
      + Cognito JWT認証                      │
            │                    ┌───────────┼───────────┐
      ブラウザ(社内数名)    Claude Desktop  claude.ai/   Claude Skill
                            (mcp-remote)    Android等    (メールトリガー)
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
| GET | `/customers?prefix=GI` | 案件名の前方一致検索 |
| GET | `/customers/{customerName}/tasks` | 指定案件のタスク一覧(ステータス順) |
| GET | `/tasks/{taskId}` | タスク詳細1件 |
| POST | `/tasks` | 新規タスク作成 |
| PATCH | `/tasks/{taskId}` | ステータス・結論・期限・担当者更新 |
| POST | `/tasks/{taskId}/emails` | Gmailスレッド紐付け追加 |

全エンドポイントは`Authorization: Bearer <Cognito IDトークン>`が必須(`DefaultAuthorizer: CognitoAuth`)。

`customerName`は日本語を含むため、フロントエンド側で`encodeURIComponent`必須。

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

## フロントエンド(React + Amplify Hosting)

`frontend/` 配下にReactアプリ本体がある。

```
frontend/
├── src/
│   ├── config.js          Cognito User Pool / API エンドポイントの設定(sam deploy後に値を反映)
│   ├── api.js              APIクライアント(Cognitoトークン自動添付、UTF-8明示エンコード)
│   ├── App.jsx              案件選択 → タスク一覧 → 新規作成のメインフロー
│   ├── CustomerSearch.jsx   案件名の前方一致検索ボックス
│   ├── TaskTable.jsx        タスク一覧(インライン編集対応)
│   ├── StatusStamp.jsx      ステータスを印鑑風バッジで表示・クリックで進める
│   ├── NewTaskForm.jsx      新規タスク作成フォーム
│   └── main.jsx              Amplify設定 + ログイン画面(Authenticator)
├── amplify.yml              Amplify Hostingのビルド設定
└── package.json
```

### デザインの方針

社内のタックス事務所向け業務ツールという位置付けのため、一般的なSaaS風のデザインではなく、
台帳・帳簿をモチーフにした落ち着いた配色とタイポグラフィを採用している。ステータスは
日本の業務文書になじみのある「印影(はんこ)」風のバッジで表現し、クリックすると
要対応→決定済→情報→完了の順に進められる。

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

### 3. Amplify Hostingへのデプロイ

AWSコンソールから:

1. Amplify Hosting → 新しいアプリ → ホスティング
2. リポジトリ未使用の場合は「手動デプロイ」を選び、`npm run build`で生成した`dist/`フォルダをZIP化してアップロード
   (Gitリポジトリと連携する場合は、`frontend/`をサブディレクトリとして指定し、`amplify.yml`をビルド設定として使う)
3. デプロイ完了後のURLを確認

### 4. 本番運用前の注意

- `template.yaml`の`HttpApi.CorsConfiguration.AllowOrigins`を`"*"`から、Amplify Hostingの実際のドメインに限定すること
- Cognitoユーザーは管理者が`admin-create-user`で作成する運用(セルフサインアップは無効化済み)

## 未実装・今後の検討事項

- `dependsOn`(タスク依存関係)の活用
- 会社名(`companyName`)と案件名(`caseName`)の分離 — 案件数が増えた場合に検討
- 他人の更新をリアルタイムにプッシュする仕組み(DynamoDB Streams + AppSync、またはWebSocket API) — 現状はポーリング想定
- 本番運用前にAPI GatewayのCORS設定(`AllowOrigins`)をAmplify Hostingのドメインのみに限定する
