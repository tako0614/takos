# Takos

**アプリを宣言的にデプロイするプラットフォーム。**

`.takos/app.yml` を書くだけで、Worker・Container・データベース・ストレージをまとめてデプロイできます。「何をデプロイするか」を宣言すれば、リソース作成・binding 接続・ドメイン設定・環境変数の注入まで Takos が自動で行います。

```yaml
# .takos/app.yml — これだけで Worker + D1 + R2 がデプロイされる
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: my-app
spec:
  version: 0.1.0
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
      bindings:
        d1: [primary-db]
        r2: [assets]
  resources:
    primary-db:
      type: d1
      binding: DB
      migrations:
        up: .takos/migrations/primary-db/up
        down: .takos/migrations/primary-db/down
    assets:
      type: r2
      binding: ASSETS
  routes:
    - name: app
      target: web
      path: /
```

```bash
takos apply --env staging    # これで完了
```

## 特徴

### 宣言的デプロイ

`app.yml` 1 ファイルに Workers、Containers、Services、リソース、ルーティング、環境変数をすべて宣言します。`takos apply` を実行すると、差分を検出してリソースの作成・更新・binding の接続・ドメイン割り当てを自動で行います。手順書やスクリプトの管理は不要です。

### Workers + Containers + Services

3 種類のワークロードを 1 つのマニフェストで組み合わせられます。

- **Workers** — Cloudflare Workers 互換のサーバーレス HTTP ハンドラ。スケジュール実行やキュー消費もサポート
- **Containers** — CF Containers (Durable Objects) 上で動く Docker コンテナ。ブラウザ自動化や ML 推論など重い処理向け
- **Services** — 常時起動の独立コンテナ。オプションで IPv4 を割り当て可能

```yaml
# Worker から Container にアクセスする例
containers:
  browser:
    dockerfile: Dockerfile
    port: 8080
    instanceType: standard-2
    maxInstances: 25

workers:
  browser-host:
    containers: [browser]     # env.BROWSER_CONTAINER で Durable Object として取得
    build: ...
```

### リソース管理

データベース・ストレージ・キュー・ベクトルインデックスなどをマニフェストで宣言するだけで、デプロイ時に自動作成・Worker に自動 binding されます。

| type | 用途 | 主な設定 |
| --- | --- | --- |
| `d1` | SQL データベース | `migrations: {up, down}` |
| `r2` | オブジェクトストレージ | — |
| `kv` | Key-Value ストア | — |
| `queue` | メッセージキュー | `maxRetries`, `deadLetterQueue` |
| `vectorize` | ベクトルインデックス | `dimensions`, `metric` |
| `analyticsEngine` | アナリティクス | `dataset` |
| `durableObject` | Durable Object | `className`, `scriptName` |
| `workflow` | Durable Workflow | `timeoutMs`, `maxRetries` |
| `secretRef` | シークレット | `generate: true` で自動生成 |

### テンプレート変数

デプロイ後に確定する URL・IP・リソース ID を環境変数に自動注入できます。サービス間の接続を宣言的に解決します。

```yaml
env:
  required:
    - API_TOKEN                              # デプロイ前に設定が必要
  inject:
    APP_URL: "{{routes.app.url}}"            # デプロイ後の URL
    APP_DOMAIN: "{{routes.app.domain}}"      # ドメイン
    API_IP: "{{services.api.ipv4}}"          # Service の IPv4
    DB_ID: "{{resources.main-db.id}}"        # リソース ID
```

### MCP Server

アプリを MCP (Model Context Protocol) サーバーとして公開できます。認証トークンも自動生成されるため、AI エージェントがアプリの機能を自動検出して利用できます。

```yaml
capabilities: [mcp]
mcpServers:
  - name: my-tools
    route: mcp-endpoint
    transport: streamable-http
    authSecretRef: mcp-secret
resources:
  mcp-secret:
    type: secretRef
    binding: MCP_AUTH_TOKEN
    generate: true
```

### OAuth クライアント自動登録

マニフェストに OAuth クライアントを宣言すると、デプロイ時に自動登録され、`OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` が Worker に注入されます。

```yaml
oauth:
  clientName: My App
  redirectUris:
    - https://example.com/callback
  scopes: [threads:read, runs:write]
  autoEnv: true
```

### ファイルハンドラ

アプリを特定の MIME タイプのハンドラとして登録できます。Space ストレージからファイルを開くとき、登録済みアプリが自動的に起動します。

```yaml
fileHandlers:
  - name: markdown
    mimeTypes: [text/markdown]
    extensions: [.md]
    openPath: /files/:id
```

### App Store

アプリを Store に公開してワンクリックでインストール可能にできます。Store は ActivityPub + ForgeFed ベースの分散カタログで、Git データは各リポジトリに残したままメタデータだけを共有します。

公式パッケージやシードリポジトリもサポートしており、ワークスペース作成時にテンプレートとして利用できます。

### マルチテナント

Dispatch namespace でテナントごとに Worker を分離します。Space (ワークスペース) 単位でメンバー・リポジトリ・リソース・ファイルを管理し、ロールベースのアクセス制御 (owner / admin / editor / viewer) を提供します。

### AI Agent 実行基盤

Thread / Run / Artifact モデルによるエージェント実行基盤を内蔵しています。

- **Thread** — 会話コンテキスト。メッセージ履歴・要約・キーポイント・成果物を保持
- **Run** — Thread 上の単一実行。`pending → queued → running → completed` のライフサイクル
- **Artifact** — Run の出力。`code`, `config`, `doc`, `patch`, `report` などの型を持つ
- **Memory** — `episode`, `semantic`, `procedural` の 3 種類の記憶
- **Reminder** — 時間・条件・コンテキストトリガーによるリマインダー

SSE (`GET /api/runs/:id/sse`) と WebSocket によるリアルタイムストリーミングに対応しています。

## 3 分で始める

### 1. CLI をインストール

```bash
deno install -gA jsr:@takos/cli
```

### 2. ログイン

```bash
takos login
takos whoami
```

### 3. app.yml を書く

プロジェクトルートに `.takos/app.yml` を作成します（上記の例を参照）。

### 4. デプロイ

```bash
takos apply --env staging
```

URL がターミナルに表示されるのでブラウザで確認できます。

詳しいチュートリアルは [docs サイト](https://docs.takos.jp) を参照してください。

## アーキテクチャ

Takos は **Control Plane** と **Tenant Runtime** の 2 層で構成されています。

**Control Plane** — API、デプロイ管理、リソースライフサイクル、ルーティング:

| Worker | 役割 |
| --- | --- |
| `takos` | Web / API / SPA、認証、課金、ルート登録 |
| `takos-dispatch` | テナントホスト名ルーティング (WFP dispatch) |
| `takos-worker` | バックグラウンド処理 (run queue, workflow, egress proxy) |
| `takos-runtime-host` | tenant runtime のコンテナホスト |
| `takos-executor-host` | agent executor のコンテナホスト |
| `takos-browser-host` | ブラウザ自動化のコンテナホスト |

**Tenant Runtime** — デプロイされたアーティファクトがリクエストを処理する層。canonical artifact は `worker-bundle` (Cloudflare Workers 互換) で、デプロイごとに config・bindings・env のスナップショットが保存されるため、ローカルと本番で同一の動作を再現でき、ロールバックも即座に行えます。

**バックエンド抽象化** — Control Plane は adapter パターンで Cloudflare とローカルの差分を吸収します。ローカル環境は Node ベースの control-plane + Workers 互換アダプタで構成され、Cloudflare アカウントなしでマニフェスト契約を検証できます。

## このリポジトリの開発

このリポジトリは Takos の core monorepo です。`packages/` が実装の正本で、`apps/*` はそれらを組み合わせる薄い composition layer です。

### リポジトリ構成

| パス | 説明 |
| --- | --- |
| `packages/control/*` | control-plane、host、local-platform |
| `packages/runtime-service` | tenant runtime サービス |
| `packages/browser-service` | ブラウザ自動化サービス |
| `packages/rust-agent-engine` | Rust agent engine (executor container 用) |
| `packages/common` | 共通ユーティリティ |
| `packages/actions-engine` | ワークフロー・マニフェスト処理 |
| `packages/cloudflare-compat` | Cloudflare 互換レイヤー |
| `apps/control` | Cloudflare Workers composition、frontend、deploy template |
| `apps/runtime` | runtime-service の Node/container ラッパー |
| `apps/rust-agent` | Rust executor container |
| `apps/cli` | Takos CLI |
| `docs/` | VitePress ドキュメントサイト |
| `scripts/` | build・validation ツール |

### 前提

- Deno 2.x
- Docker / Docker Compose (ローカルスタック利用時)

### セットアップ

```bash
deno install
```

### 主要コマンド

```bash
# テスト・品質
deno task test:all          # 全テスト実行
deno task lint              # lint
deno task fmt               # format

# ドキュメント
deno task docs:dev          # docs プレビュー
deno task docs:build        # docs ビルド
deno task docs:deploy       # docs デプロイ (Cloudflare Pages)

# ローカル開発 (個別サービス)
deno task dev:takos         # control-plane 開発サーバー
deno task dev:runtime       # runtime 開発サーバー
deno task dev:cli           # CLI 開発

# ローカルスタック (Docker Compose)
cp .env.local.example .env.local
deno task local:up          # 全サービス起動
deno task local:down        # 停止
```

### ローカルスタックのサービス

| サービス | 役割 | ポート |
| --- | --- | --- |
| `control-web` | Web / API | 8787 |
| `control-dispatch` | テナント振り分け | 8788 |
| `control-worker` | バックグラウンド処理 | — |
| `runtime-host` / `runtime` | tenant runtime | 8789 |
| `executor-host` / `rust-agent` | agent executor | 8790 |
| `browser-host` / `browser` | ブラウザ自動化 | 8791 |
| `postgres` / `redis` / `minio` | インフラ | 15432 / 16379 / 19000 |

### デプロイ

- Cloudflare: `apps/control/wrangler*.toml`
- Helm / self-host: `deploy/helm/takos/`
- Terraform: `deploy/terraform/`

本番デプロイは [`takos-private/`](../takos-private) で行います。

## ドキュメント

仕様・チュートリアル・サンプル集・アーキテクチャの詳細は `docs/` の VitePress サイトに集約しています。

```bash
deno task docs:dev    # http://localhost:5173 でプレビュー
```

主なセクション:

- **はじめる** — 3 分 Quickstart、はじめてのアプリ、プロジェクト構成
- **アプリ仕様** — マニフェスト、Workers、Containers、Routes、環境変数、MCP、OAuth、ファイルハンドラ
- **デプロイ** — `takos apply`、ロールバック、namespace
- **ホスティング** — Cloudflare、AWS、GCP、Kubernetes、セルフホスト、ローカル開発
- **プラットフォーム** — Store、Threads/Runs、Spaces、ActivityPub
- **サンプル集** — シンプル Worker、Worker+DB、Worker+Container、MCP Server、マルチサービス

## Contributing

`CONTRIBUTING.md`、`SECURITY.md` を参照してください。
