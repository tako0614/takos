# takos

> AIエージェント、group、Worker、ワークフローを、
> ユーザー自身が所有・運用できる形で構築・実行・配布するためのプラットフォーム。

**takos**
は、コード管理、デプロイ、実行、ツール拡張、ワークフロー自動化をひとつの基盤に統合し、
そのすべてをユーザーが理解・追跡・改変できる状態に保つことを目指すソフトウェア基盤です。

既存の SaaS
やプラットフォームが「便利だが中身が見えないもの」を提供するのに対し、 takos
が提供するのは、**自分で持ち、運用し、必要に応じて改変や移行もできる基盤**です。

> [!WARNING]
> takos is under active development. APIs, repository layout, and specifications
> may change.

---

## なぜ takos なのか

現代のソフトウェアプラットフォームは便利です。
しかし同時に、強い支配力を持っています。

- API の突然の有料化
- アルゴリズム変更による到達範囲の変化
- 規約変更による既存ユースケースの切り捨て
- 価格改定と移行コストによるロックイン
- 中身が見えないブラックボックス化

takos は、この構造に対して **「基盤そのものをユーザーが所有できる形にする」**
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

この条件が揃ってはじめて、ソフトウェアを「所有している」と言える。 takos
はその前提で設計されています。

---

## takos の特徴

### 1. AI-native な実行基盤

takos は、AI エージェント、group、Worker、API サーバー、ワークフローを
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

takos は標準の **Git Smart HTTP v2** を実装し、 通常の Git クライアントから
`clone / push / pull` できます。

group の実装だけでなく、以下もリポジトリで管理します。

- Worker
- ツール
- 設定ファイル
- プロンプト
- ワークフロー
- AI が生成したコード

これにより、変更追跡、フォーク、再利用、可視化が可能になります。

---

### 3. Store 的 UX と manifest ベースの導入

リポジトリの root に deploy manifest (`.takos/app.yml`) を置くことで、group の
install / update を簡単に行える設計です。`.takos/app.yml` は既定の deploy
manifest path で、app catalog ではありません。

目指しているのは、 **アプリストアのように導入できるのに、中身は閉じていない**
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

つまり、与えられた道具だけで働くのではなく、 **必要なら道具そのものを作る**
ことができます。

---

### 5. スキルシステム

エージェントの振る舞いはスキルとして構成されます。

- **Takos-managed skills** プラットフォームが初期注入する managed skill source
- **Space custom skills** ユーザーが space 単位で管理する custom skill source

ロケールや利用環境に応じて適切なスキルを有効化し、
使えるツールや行動パターンを制御します。

---

### 6. Memory Activation Graph

takos のエージェントは、独自の記憶機構 **Memory Activation Graph** を備えます。

特徴:

- ツール実行や観察から得た事実を記憶として蓄積
- 単なるベクトル近傍ではなく、意味的・文脈的な関係で構造化
- 現在のコンテキストに近い記憶を活性化
- 関連情報を連鎖的に参照
- `remember` tool による探索的アクセス

これにより、単発の検索ではなく、 **文脈を持った記憶の束** を使って推論できます。

---

### 7. Hosted でも Self-host でも使える

takos.jp は takos のホステッド版のひとつにすぎません。

ユーザーは:

- そのまま hosted 版を使う
- 自前インフラで self-host する
- 別の運営者のインスタンスを使う
- フォークして独自要件に合わせる

ことができます。

takos の価値は「一つの正しい運営元」に依存せず、 **選べることそのもの**
にあります。

---

## ユースケース

### 自分の SNS を自分で持つ

ActivityPub や AT Protocol 系の分散型 SNS をホストし、 SNS
をプラットフォーム依存ではなく自分で管理する。

### OSS ライブラリを AI tool 化する

まだ group として配布されていない便利な OSS ライブラリを Worker 化し、 AI
エージェントから使える tool にする。

### 新しい group をゼロから作る

coding agent としての takos を使い、 新規 group の実装、管理、公開まで繋げる。

### コミュニティ専用ツールを運用する

部活、サークル、小規模店舗、地域コミュニティ向けの 専用 group
や予約・管理ツールをホストする。

### MCP サーバーを構築する

AI 時代のサービス提供形態として、 Web UI だけでなく MCP ベースの機能提供を行う。

---

## アーキテクチャ概要

```text
Browser / CLI / Git Client
           |
      takos-dispatch
           |
   +-------+--------+
   |                |
 takos        Tenant Workers
   |
   +--> takos-worker (run / index / workflow / deploy queues)
   +--> Executor (AI agent)
   +--> Runtime (Node.js sandbox)
   |
   +--> SQL / object-store / key-value
```

### ざっくりした役割

- **takos-dispatch** ホスト名ルーティングを行うディスパッチ層
- **takos** コントロールプレーン、認証、管理 UI、API
- **Tenant Workers** ユーザーが構築・配布した実行単位
- **takos-worker / Executor / Runtime**
  エージェント実行、非同期処理、ワークフロー、デプロイ処理
- **SQL / object-store / key-value stores**
  メタデータ、アーティファクト、キャッシュ、ルーティング補助

---

## 技術スタック

### Language / Runtime

- TypeScript / Deno 2.x
- Rust (agent engine)

### Backend

- Hono
- Drizzle ORM
- SQL database adapters
- Object-store / key-value adapters
- jose
- Zod

### AI / Agent

- OpenAI / Anthropic / Google / OpenAI-compatible model backends
- MCP (Model Context Protocol)
- LangGraph

### Frontend

- React
- Vite
- Tailwind CSS
- Jotai
- React Router
- Monaco Editor

### Infrastructure

- Worker runtime / SQL / object-store / key-value / Queues / Containers
- Docker Compose / Miniflare (ローカル開発)
- Terraform / Helm (セルフホスト)
- GitHub Actions

> [!NOTE]
> 参照実装では Cloudflare 系技術を強く活用していますが、 Miniflare + Docker
> による抽象化で AWS / GCP / Kubernetes / セルフホスト環境でも動作する設計です。

---

## 現在の状態

現時点で、takos では以下のような中核機能の試作が進んでいます。

- 認証
- スペース管理
- デプロイ制御を担うコントロールプレーン
- Web フロントエンド
- CLI
- Git Smart HTTP v2 ベースの Git ホスティング
- 複数 LLM プロバイダ対応の AI エージェント
- ツール実行機構
- 記憶機構

まだ OSS 公開に向けた整備途中ですが、
構想だけでなく、基盤となる主要機能はすでに試作されています。

---

## OSS としての takos

takos は、単にコードを公開するだけのプロジェクトではありません。
本当に目指しているのは、
**プラットフォームを一社が支配する構造そのものを超えること** です。

ユーザーが作った Worker、group、ツール、ワークフロー、プロンプト、設定は、
特定運営者の囲い込み資産ではなく、
ユーザー自身の資産として残り続けるべきだと考えています。

---

## 使い方

> [!NOTE]
> 公開向けのセットアップ手順やドキュメントは現在整備中です。
> 以下は現時点で動作する開発フローの概要です。

### CLI インストール

Takos CLI は `takos-cli/` repository が正本です。現時点では JSR package release
flow は未整備のため、compiled binary か direct Deno 実行を使います。

```bash
cd ../takos-cli
deno install -gA -n takos src/index.ts
```

### 開発コマンド

repo root では Deno task を使う。

```bash
deno task build:all
deno task test:all
deno task docs:dev
deno task dev:takos
deno task local:up
deno task local:smoke
```

### ログイン

```bash
takos login          # ブラウザで認証
takos whoami         # 確認
```

### deploy manifest を書く

プロジェクトルートに deploy manifest (`.takos/app.yml`)
を配置します。`.takos/app.yml` は既定の deploy manifest path で、app catalog
ではありません。deploy lifecycle では worker / service / route / publication
が共有する group deploy scope として扱います。

```yaml
name: my-app
version: 0.1.0

publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos-api
        env:
          endpoint: TAKOS_API_ENDPOINT
          apiKey: TAKOS_API_KEY

routes:
  - target: web
    path: /
```

この例では Worker 1 つと Takos capability grant 1 つを宣言しています。接続情報は
`consume` で明示的に受け取ります。`publish` は group が共有する information
sharing / access output の catalog で、resource creation ではありません。

### デプロイ

```bash
takos deploy --env staging --space SPACE_ID --group GROUP_NAME       # ステージング
takos deploy --env production --space SPACE_ID --group GROUP_NAME    # 本番
takos deploy --plan --space SPACE_ID --group GROUP_NAME              # 差分だけ確認
```

deploy の public entrypoint は `takos deploy` と `takos deploy --plan` です。

### その他の主要コマンド

```bash
takos endpoint use prod         # 接続先の切り替え
takos endpoint show             # 現在の接続先を確認
takos logout                    # ログアウト
```

### Capability grant

Takos API key や OAuth client は `publish` に `publisher: takos` として宣言し、
必要な compute が `consume` で endpoint / credential を受け取ります。public
manifest には backend 名を書きません。SQL / object-store / queue などの resource
は publish ではなく deploy resource lifecycle / runtime binding 側で扱います。

| type           | 用途            | outputs                              |
| -------------- | --------------- | ------------------------------------ |
| `api-key`      | Takos API token | `endpoint`, `apiKey`                 |
| `oauth-client` | OAuth client    | `clientId`, `clientSecret`, `issuer` |

### 環境変数

group 固有の固定値は top-level `env` に書きます。publication / capability grant
由来の値は consumer 側の `consume[].env` alias で受け取ります。

```yaml
env:
  LOG_LEVEL: info

publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos-api
        env:
          endpoint: TAKOS_API_ENDPOINT
          apiKey: TAKOS_API_KEY
```

### MCP Server の共有

```yaml
name: my-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: automation-api
        env:
          url: AUTOMATION_MCP_URL

routes:
  - target: web
    path: /mcp

publish:
  - name: automation-api
    publisher: web
    type: McpServer
    path: /mcp
    spec:
      transport: streamable-http
```

Web UI を作らなくても、AI エージェントから直接叩けるサービスを公開できます。
`McpServer` は custom route publication type です。

### OAuth クライアント自動登録

```yaml
name: my-app

publish:
  - name: oauth-client
    publisher: takos
    type: oauth-client
    spec:
      clientName: My App
      redirectUris: [https://example.com/callback]
      scopes: [threads:read, runs:write]

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: oauth-client
        env:
          clientId: OAUTH_CLIENT_ID
          clientSecret: OAUTH_CLIENT_SECRET
          issuer: OAUTH_ISSUER_URL
```

### ファイルハンドラ

ファイルハンドラの公開は [File Handlers](docs/apps/file-handlers.md) を参照。

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

Takos 1.0 は、Takos core を OSS GA として扱える状態にすることを目標にしています。
固定の公開日は置かず、milestone の完了条件を満たしたら次へ進みます。

- M0 Contract Freeze: manifest / CLI / API / terminology の互換境界を固定
- M1 OSS Self-Host GA: OSS checkout だけで single-node production self-host を再現
- M2 Deploy / Git / API GA: deploy lifecycle、Git Smart HTTP、Store install、resource surface を安定化
- M3 Agent GA: Thread / Run、Rust agent、skills、remote tools、memory、usage reporting を production feature 化
- M4 Release Hardening: release candidate、CLI artifact、docs、migration、smoke test を揃える

詳細な内部計画は `plan/road-to-1.0.md`、公開向けの要約は
[Road to Takos 1.0](docs/platform/road-to-1.0.md) を参照してください。

---

## ライセンス

**Planned:** AGPL-3.0-or-later
