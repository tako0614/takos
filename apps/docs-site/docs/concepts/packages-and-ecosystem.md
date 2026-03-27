# Package / Ecosystem

Takos のエコシステムは、`.takos/app.yml` manifest を含むリポジトリ (パッケージ) の集合です。パッケージはワークスペースにデプロイされ、MCP 経由でエージェントにツールを提供します。

## パッケージとは

パッケージは `.takos/app.yml` を持つ Git リポジトリです。manifest がデプロイの宣言であり、Takos はそれを読んで Workload, Resource, Binding, Endpoint, McpServer をプロビジョニングします。

パッケージの例:

- **takos-computer** — ブラウザ自動化 + エージェント実行 (公式)
- ユーザーが作成するカスタムツールパッケージ
- サードパーティの MCP ツールサーバー

## Seed repositories

新しいワークスペースを作成するとき、フロントエンドは `GET /api/seed-repositories` から推奨パッケージの一覧を取得し、ポップアップで表示します。ユーザーが選択したリポジトリがワークスペースにクローンされ、デプロイされます。

```
seed-repositories.ts
  └── SEED_REPOSITORIES: [{ url, name, description, category, checked }]
```

`checked: true` のパッケージはデフォルトで選択されています。これは store (発見のための仕組み) とは独立した仕組みです。store はリポジトリを発見するためのもの、seed repositories は初回セットアップのためのものです。

## MCP によるツール統合

Takos ではすべてのツールを MCP (Model Context Protocol) で統合します。パッケージがツールを提供する場合:

1. パッケージは MCP サーバーエンドポイント (`POST /mcp`) を公開する
2. manifest で `McpServer` kind を宣言する
3. デプロイ時に `mcp_servers` テーブルに自動登録される
4. エージェント実行時に `loadMcpTools()` がツールを読み込む

builtin tool の仕組みは残りますが、新規ツールはすべて MCP で統合する方針です。

## 認証モデル

パッケージには 2 種類の認証トークンがあり、用途が異なります。

### TAKOS_ACCESS_TOKEN — Worker から Takos API を呼ぶ

```yaml
kind: Package
spec:
  env:
    required: [TAKOS_ACCESS_TOKEN]
  takos:
    scopes: [threads:read, runs:write]
```

デプロイ時に `tak_pat_` トークンが自動生成され、Worker の環境変数に注入されます。Worker はこのトークンで Takos API を呼べます。**Takos コントロールプレーンが検証します。**

### secretRef + authSecretRef — MCP サーバーの認証

```yaml
# 1. シークレットを宣言 (デプロイ時に自動生成)
kind: Resource
metadata:
  name: mcp-secret
spec:
  type: secretRef
  generate: true

# 2. Worker の環境変数に注入
kind: Binding
spec:
  from: mcp-secret
  to: my-worker
  mount:
    as: MCP_AUTH_TOKEN

# 3. MCP サーバーの Bearer 認証に使用
kind: McpServer
spec:
  authSecretRef: mcp-secret
```

デプロイ時にランダムトークンが生成され、同じ値が Worker env と MCP 登録の両方に注入されます。**MCP サーバー (Worker 自身) が検証します。**

### 使い分け

| | TAKOS_ACCESS_TOKEN | secretRef |
| --- | --- | --- |
| 用途 | Worker → Takos API | McpClient → MCP サーバー |
| 検証者 | Takos | Worker 自身 |
| 形式 | `tak_pat_...` | ランダム base64url |
| スコープ制御 | `takos.scopes` | なし (全 or 無) |

## パッケージのデプロイフロー

```
リポジトリ → .takos/app.yml パース
  → Resource プロビジョニング (D1, R2, secretRef 等)
  → OAuth クライアント作成 (必要な場合)
  → Workload デプロイ (container / worker)
    → Resource Binding 注入
    → secretRef → 環境変数注入
  → Endpoint 登録
  → McpServer 登録
    → authSecretRef → Bearer token 保存
  → Rollout (staged / immediate)
```

## takos-computer

Takos 公式のリファレンスパッケージです。ブラウザ自動化とエージェント実行を提供します。

**提供するツール (MCP 経由):**

| tool | description |
| --- | --- |
| `browser_open` | ブラウザセッションを開く |
| `browser_goto` | URL に遷移する |
| `browser_action` | ページ操作 (click, type, scroll 等) |
| `browser_screenshot` | スクリーンショットを取得する |
| `browser_extract` | ページからデータを抽出する |
| `browser_html` | ページ HTML を取得する |
| `browser_close` | ブラウザセッションを閉じる |

**アーキテクチャ:**

```
takos-computer/
  apps/
    browser/     → Playwright コンテナ
    executor/    → LLM エージェント実行コンテナ
  packages/
    browser-service/  → MCP サーバー (POST /mcp)
    executor-service/  → Control RPC クライアント
    computer-hosts/   → CF Worker (thin proxy)
  .takos/app.yml     → manifest
```

manifest の全文は [`.takos/app.yml` 仕様](/specs/app-manifest) のリファレンスセクションを参照してください。
