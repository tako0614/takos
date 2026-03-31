# takos

> AIエージェント、アプリケーション、Worker、ワークフローを、
> ユーザー自身が所有・運用できる形で構築・実行・配布するためのプラットフォーム。

**takos** は、コード管理、デプロイ、実行、ツール拡張、ワークフロー自動化をひとつの基盤に統合し、
そのすべてをユーザーが理解・追跡・改変できる状態に保つことを目指すソフトウェア基盤です。

既存の SaaS やプラットフォームが「便利だが中身が見えないもの」を提供するのに対し、
takos が提供するのは、**自分で持ち、運用し、必要に応じて改変や移行もできる基盤**です。

> [!WARNING]
> takos is under active development.
> APIs, repository layout, and specifications may change.

---

## なぜ takos なのか

現代のソフトウェアプラットフォームは便利です。
しかし同時に、強い支配力を持っています。

- API の突然の有料化
- アルゴリズム変更による到達範囲の変化
- 規約変更による既存ユースケースの切り捨て
- 価格改定と移行コストによるロックイン
- 中身が見えないブラックボックス化

takos は、この構造に対して
**「基盤そのものをユーザーが所有できる形にする」**
という方向から取り組みます。

---

## takos が考える「所有」

takos における所有は、単なる利用権ではありません。

- 何が動いているかを理解できる
- どのコードと設定から現状に至ったかを追跡できる
- 壊れたら自分で修正できる
- 以前の状態に戻せる
- 他の人に引き継げる
- 必要ならフォークして改変できる
- 別の環境へ移行できる

この条件が揃ってはじめて、ソフトウェアを「所有している」と言える。
takos はその前提で設計されています。

---

## takos の特徴

### 1. AI-native な実行基盤

takos は、AI エージェント、アプリケーション、Worker、API サーバー、ワークフローを
同じ所有権モデルの上で構築・実行・配布できるようにします。

単なるホスティングではなく、以下を含む基盤です。

- 認証
- 環境変数 / シークレット管理
- リソース接続
- バージョン管理
- ロールバック
- デプロイ管理

---

### 2. Git-native なコード管理

takos は標準の **Git Smart HTTP v2** を実装し、
通常の Git クライアントから `clone / push / pull` できます。

アプリ本体だけでなく、以下もリポジトリで管理します。

- Worker
- ツール
- 設定ファイル
- プロンプト
- ワークフロー
- AI が生成したコード

これにより、変更追跡、フォーク、再利用、可視化が可能になります。

---

### 3. Store 的 UX と manifest ベースの導入

リポジトリの root に `.takos/app.yml` を置くことで、
アプリケーションの install / update を簡単に行える設計です。

目指しているのは、
**アプリストアのように導入できるのに、中身は閉じていない**
という体験です。

---

### 4. ツール自己拡張ができる AI エージェント

takos の AI エージェントは、チャットに返答するだけの存在ではありません。

- リポジトリを読む
- コードを書く
- 必要なツールを探す
- Worker を生成する
- リポジトリにコミットする
- デプロイする
- 新しいツールとして登録する

つまり、与えられた道具だけで働くのではなく、
**必要なら道具そのものを作る** ことができます。

---

### 5. スキルシステム

エージェントの振る舞いはスキルとして構成されます。

- **Official Skills**
  プラットフォームが提供する標準スキル
- **Custom Skills**
  ユーザーがスペース単位で定義するスキル

ロケールや利用環境に応じて適切なスキルを有効化し、
使えるツールや行動パターンを制御します。

---

### 6. Memory Activation Graph

takos のエージェントは、独自の記憶機構
**Memory Activation Graph** を備えます。

特徴:

- ツール実行や観察から得た事実を記憶として蓄積
- 単なるベクトル近傍ではなく、意味的・文脈的な関係で構造化
- 現在のコンテキストに近い記憶を活性化
- 関連情報を連鎖的に参照
- `remember` tool による探索的アクセス

これにより、単発の検索ではなく、
**文脈を持った記憶の束** を使って推論できます。

---

### 7. Hosted でも Self-host でも使える

takos.jp は takos のホステッド版のひとつにすぎません。

ユーザーは:

- そのまま hosted 版を使う
- 自前インフラで self-host する
- 別の運営者のインスタンスを使う
- フォークして独自要件に合わせる

ことができます。

takos の価値は「一つの正しい運営元」に依存せず、
**選べることそのもの** にあります。

---

## ユースケース

### 自分の SNS を自分で持つ
ActivityPub や AT Protocol 系の分散型 SNS をホストし、
SNS をプラットフォーム依存ではなく自分で管理する。

### OSS ライブラリを AI tool 化する
アプリになっていない便利な OSS ライブラリを Worker 化し、
AI エージェントから使える tool にする。

### 新しいアプリケーションをゼロから作る
coding agent としての takos を使い、
新規アプリケーションの実装、管理、公開まで繋げる。

### コミュニティ専用ツールを運用する
部活、サークル、小規模店舗、地域コミュニティ向けの
専用アプリや予約・管理ツールをホストする。

### MCP サーバーを構築する
AI 時代のサービス提供形態として、
Web UI だけでなく MCP ベースの機能提供を行う。

---

## アーキテクチャ概要

```text
Browser / CLI / Git Client
           |
      takos-dispatch
           |
   +-------+--------+
   |                |
takos-web      Tenant Workers
   |
   +--> Queues (run / index / workflow / deploy)
   +--> Executor (AI agent)
   +--> Runtime (Node.js sandbox / browser)
   +--> Browser automation
   |
   +--> D1 / R2 / KV
```

### ざっくりした役割

* **takos-dispatch**
  ホスト名ルーティングを行うディスパッチ層
* **takos-web**
  コントロールプレーン、認証、管理 UI、API
* **Tenant Workers**
  ユーザーが構築・配布した実行単位
* **Queues / Executor / Runtime**
  エージェント実行、非同期処理、ワークフロー、デプロイ処理
* **D1 / R2 / KV**
  メタデータ、アーティファクト、キャッシュ、ルーティング補助

---

## 技術スタック

### Language / Runtime

* TypeScript / Deno 2.x
* Rust (agent engine)

### Backend

* Hono
* Drizzle ORM
* Cloudflare D1 / PostgreSQL / SQLite
* Cloudflare R2 / KV
* jose
* Zod

### AI / Agent

* OpenAI / Anthropic / Google / OpenAI-compatible providers
* MCP (Model Context Protocol)
* LangGraph
* Playwright (ブラウザ自動化)

### Frontend

* React
* Vite
* Tailwind CSS
* Jotai
* React Router
* Monaco Editor

### Infrastructure

* Cloudflare Workers / D1 / R2 / KV / Queues / Containers
* Docker Compose / Miniflare (ローカル開発)
* Terraform / Helm (セルフホスト)
* GitHub Actions

> [!NOTE]
> 参照実装では Cloudflare 系技術を強く活用していますが、
> Miniflare + Docker による抽象化で AWS / GCP / Kubernetes / セルフホスト環境でも動作する設計です。

---

## 現在の状態

現時点で、takos では以下のような中核機能の試作が進んでいます。

* 認証
* スペース管理
* デプロイ制御を担うコントロールプレーン
* Web フロントエンド
* CLI
* Git Smart HTTP v2 ベースの Git ホスティング
* 複数 LLM プロバイダ対応の AI エージェント
* ツール実行機構
* 記憶機構

まだ OSS 公開に向けた整備途中ですが、
構想だけでなく、基盤となる主要機能はすでに試作されています。

---

## OSS としての takos

takos は、単にコードを公開するだけのプロジェクトではありません。
本当に目指しているのは、
**プラットフォームを一社が支配する構造そのものを超えること** です。

ユーザーが作った Worker、アプリ、ツール、ワークフロー、プロンプト、設定は、
特定運営者の囲い込み資産ではなく、
ユーザー自身の資産として残り続けるべきだと考えています。

---

## 使い方

> [!NOTE]
> 公開向けのセットアップ手順やドキュメントは現在整備中です。
> 以下は現時点で動作する開発フローの概要です。

### CLI インストール

```bash
deno install -gA jsr:@takos/cli
```

### ログイン

```bash
takos login          # ブラウザで認証
takos whoami         # 確認
```

### app.yml を書く

プロジェクトルートに `.takos/app.yml` を配置します。

```yaml
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

この例では Worker 1 つ、D1 データベース 1 つ、R2 バケット 1 つが宣言されています。
リソース作成、binding 接続、ドメイン割り当て、マイグレーション適用はすべて `apply` 時に自動で行われます。

### デプロイ

```bash
takos apply --env staging       # ステージング
takos apply --env production    # 本番
```

差分があれば更新、なければスキップ。ロールバックも可能です。

### その他の主要コマンド

```bash
takos plan                      # apply せずに差分だけ確認
takos endpoint use prod         # 接続先の切り替え
takos endpoint show             # 現在の接続先を確認
takos logout                    # ログアウト
```

### マニフェストで宣言できるリソース

| type | 用途 | 特記 |
| --- | --- | --- |
| `d1` | SQL データベース | マイグレーション管理つき |
| `r2` | オブジェクトストレージ | |
| `kv` | Key-Value ストア | |
| `queue` | メッセージキュー | dead letter queue、リトライ制御 |
| `vectorize` | ベクトル検索 | 次元数・距離関数を指定 |
| `analyticsEngine` | アナリティクス | |
| `durableObject` | ステートフルオブジェクト | |
| `workflow` | ワークフロー | タイムアウト・リトライ制御 |
| `secretRef` | シークレット | `generate: true` で自動生成 |

### テンプレート変数

デプロイ後に確定する URL・IP・リソース ID を環境変数として自動注入できます。

```yaml
env:
  inject:
    APP_URL: "{{routes.app.url}}"
    API_IP: "{{services.api.ipv4}}"
    DB_ID: "{{resources.main-db.id}}"
```

### MCP Server の公開

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

Web UI を作らなくても、AI エージェントから直接叩けるサービスを公開できます。

### OAuth クライアント自動登録

```yaml
oauth:
  clientName: My App
  redirectUris: [https://example.com/callback]
  scopes: [threads:read, runs:write]
  autoEnv: true     # CLIENT_ID / CLIENT_SECRET が自動注入
```

### ファイルハンドラ

```yaml
fileHandlers:
  - name: markdown-editor
    mimeTypes: [text/markdown]
    extensions: [.md]
    openPath: /files/:id
```

### ローカル開発 (コントリビューター向け)

```bash
deno install

# テスト・品質
deno task test:all
deno task lint
deno task fmt

# 個別サービス開発
deno task dev:takos         # control-plane
deno task dev:runtime       # runtime
deno task dev:cli           # CLI

# ドキュメント
deno task docs:dev          # プレビュー (VitePress)
deno task docs:build
deno task docs:deploy       # Cloudflare Pages へデプロイ

# ローカルスタック (Docker Compose)
cp .env.local.example .env.local
deno task local:up          # 全サービス起動
deno task local:down        # 停止
```

---

## ロードマップ

* OSS 公開に向けたリポジトリ整備
* セットアップ手順と運用ドキュメントの整備
* CI / テスト / ライセンスの公開対応
* 独自仕様の安定化
* AI エージェントアーキテクチャの洗練
* セルフホストを前提とした UX の強化
* Store / manifest / tool distribution 体験の改善

---

## ライセンス

**Planned:** AGPL-3.0-or-later
