# Takos

**自分で持ち、運用し、改変も移行もできるソフトウェア基盤。**

Takos は、AI エージェント・アプリケーション・Worker・ワークフローを、ユーザー自身が所有・運用できる形で構築・実行・配布するためのプラットフォームです。コード管理、デプロイ、実行、ツール拡張、ワークフロー自動化を一つの基盤に統合し、その全てをユーザーが理解・追跡・改変できる状態に保ちます。

既存の SaaS やプラットフォームが「便利だが中身が見えないもの」を提供するのに対し、Takos が提供するのは「自分で持ち、運用し、必要に応じて改変や移行もできるソフトウェア基盤」です。

## なぜ Takos が必要か

プラットフォームは便利であると同時に、支配の道具にもなり得ます。Twitter は突然 API を有料化し、Google Play はアルゴリズム変更でアプリの到達範囲を一夜で変え、SaaS は価格を倍にしても移行コストの壁がユーザーを引き留めます。これらは個別の問題ではなく、**ユーザーが基盤を所有していないから、基盤を持つ側の決定に従うしかない**という同じ構造から生まれています。

Takos はこの問題に対し、「基盤そのものをユーザーが所有できる形にする」というアプローチをとります。動いている内容を確認でき、変更を追跡でき、壊れたら自分で直せ、不要になれば別の環境に持ち出せる。それが Takos の言う「所有」です。

### OSS としての Takos

Takos は AGPL v3 のオープンソースソフトウェアです。これは理念の表明ではなく、「所有」の帰結です。基盤のコードが非公開であれば、その約束を検証する手段がありません。OSS であることで、ユーザーは Takos の動作を自分で検証し、セルフホストにより特定のインフラへの依存を排し、フォークして独自の要件に合わせた基盤を構築できます。

Takos は誰か一人が全てを設計し運用するものではありません。OSS であることは、みんなで作り、みんなで育て、みんなで使うための前提条件です。

### takos.jp との関係

[takos.jp](https://takos.jp) で提供されるサービスは Takos のホステッド版の一つに過ぎません。takos.jp の運営者はベンダーであり、プラットフォームの支配者ではありません。価格や条件が合わなくなったら、データとコードを持って離脱できます。企業が社内向けに運用する Takos、教育機関が学生向けに提供する Takos、コミュニティが共同運営する Takos——それぞれが独立したインスタンスでありながら、同じ OSS の上に成り立ちます。

## 何ができるか

### 宣言的デプロイ

`.takos/app.yml` を書くだけで、Worker・Container・データベース・ストレージをまとめてデプロイできます。

```yaml
# .takos/app.yml
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

リソース作成・binding 接続・ドメイン設定・環境変数の注入まで自動で行います。

### Workers + Containers + Services

3 種類のワークロードを 1 つのマニフェストで組み合わせられます。

- **Workers** — Cloudflare Workers 互換のサーバーレス HTTP ハンドラ。スケジュール実行やキュー消費もサポート
- **Containers** — CF Containers (Durable Objects) 上で動く Docker コンテナ。ブラウザ自動化や ML 推論など重い処理向け
- **Services** — 常時起動の独立コンテナ。オプションで IPv4 を割り当て可能

```yaml
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

デプロイ後に確定する URL・IP・リソース ID を環境変数に自動注入できます。

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

アプリを MCP (Model Context Protocol) サーバーとしてワンライン宣言で自動公開できます。認証トークンも自動生成されるため、AI エージェントがアプリの機能を自動検出して利用できます。

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

### AI Agent 実行基盤

Thread / Run / Artifact モデルによるエージェント実行基盤を内蔵しています。

- **Thread** — 会話コンテキスト。メッセージ履歴・要約・キーポイント・成果物を保持
- **Run** — Thread 上の単一実行。`pending → queued → running → completed` のライフサイクル
- **Artifact** — Run の出力。`code`, `config`, `doc`, `patch`, `report` などの型を持つ
- **Memory** — `episode`, `semantic`, `procedural` の 3 種類の記憶
- **Reminder** — 時間・条件・コンテキストトリガーによるリマインダー

SSE と WebSocket によるリアルタイムストリーミングに対応。Coding agent としても機能し、アプリケーションをゼロから構築できます。

### App Store

アプリを Store に公開してワンクリックでインストール可能にできます。Store は ActivityPub + ForgeFed ベースの分散カタログで、Git データは各リポジトリに残したままメタデータだけを共有します。

npm や crates.io のようなレジストリに近いですが、対象はライブラリに限りません。アプリケーション、Worker、ツール、ワークフロー、プロンプト、設定テンプレートまで、ソフトウェアに関わるあらゆるものが同じ流通の仕組みの上を流れます。特別な審査やゲートキーパーを前提としません。

### OAuth クライアント自動登録

マニフェストに宣言するだけでデプロイ時に自動登録され、`OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` が Worker に注入されます。

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

### マルチテナント

Dispatch namespace でテナントごとに Worker を分離。Space (ワークスペース) 単位でメンバー・リポジトリ・リソース・ファイルを管理し、ロールベースのアクセス制御 (owner / admin / editor / viewer) を提供します。

### インフラ非依存

Cloudflare の技術をベースにしていますが、実行環境自体は特定のインフラに依存しない設計です。Miniflare と Docker による抽象化で、AWS・GCP・Kubernetes・セルフホスト環境でも動作します。

## 利用例

**自分の SNS を自分で管理する** — ActivityPub や AT Protocol 対応の分散型 SNS をホスト。Takos エコシステムで開発された一人用 ActivityPub SNS「[Yurucommu](../yurucommu)」との親和性が高い。

**OSS ライブラリを AI tool 化する** — アプリケーションになっていない便利なライブラリを Worker にしてデプロイすることで、AI の tool として活用できる。

**全く新しいアプリケーションをゼロから構築する** — Coding agent としても機能し、アプリケーションを構築。OSS にすればエコシステムに貢献できる。

**コミュニティ専用ツールのホスト** — 部活の出欠管理アプリ、小規模店舗の予約問い合わせアプリなど。

**MCP サーバーを作る** — AI 時代において Web の UI は縮小し、MCP サーバーでサービスを提供することが主流になると予想される。Takos は MCP サービスの構築に最適。

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

URL がターミナルに表示されるのでブラウザで確認できます。詳しいチュートリアルは [docs サイト](https://docs.takos.jp) を参照してください。

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

## License

GNU AGPL v3。詳細は `LICENSE` を参照してください。

## Contributing

`CONTRIBUTING.md`、`SECURITY.md` を参照してください。
