# ローカル開発

Docker Compose ベースのローカル開発環境。Cloudflare アカウントなしで Takos を動かせる。

## 前提

- Node.js 20+
- pnpm 9+
- Docker（current stable）
- Docker Compose V2

## セットアップ

```bash
corepack pnpm install
cp .env.local.example .env.local
```

## 起動・停止

```bash
pnpm local:up        # 起動（foreground）
pnpm local:logs      # ログ確認
pnpm local:down      # 停止
```

バックグラウンドで起動したい場合:

```bash
docker compose --env-file .env.local -f compose.local.yml up --build -d
```

## スモークテスト

```bash
pnpm local:smoke              # 全体の疎通確認
pnpm local:proxyless-smoke    # CF 固有 path の逆流チェック
```

### `pnpm local:proxyless-smoke` とは

CF 固有のルーティングパス（Cloudflare Workers 環境でのみ通るパス）がローカル環境で意図せず「逆流」しないかを確認するテスト。セルフホスト環境で Cloudflare 依存のルーティングが紛れ込んでいないかを検証する。

## 主要サービス

| サービス | ポート | 役割 |
| --- | --- | --- |
| `control-web` | `8787` | Web / API worker |
| `control-dispatch` | `8788` | テナント dispatch |
| `control-worker` | - | バックグラウンド worker |
| `runtime-host` | `8789` | テナントランタイム host |
| `runtime` | `8081` | テナントランタイム container |
| `executor-host` | `8790` | エージェント executor host |
| `executor` | `8082` | エージェント executor container |
| `browser-host` | `8791` | ブラウザ自動化 host |
| `browser` | `8083` | ブラウザ自動化 container |
| `oci-orchestrator` | `9002` | コンテナライフサイクル管理 |
| `postgres` | `15432` | PostgreSQL（D1 互換） |
| `redis` | `16379` | Redis（KV 互換） |
| `minio` | `19000` / `19001` | MinIO（R2 互換） |

## 個別起動

compose を使わずに個別にサービスを起動する場合。事前に PostgreSQL / Redis / MinIO が起動している前提。

### Control Plane サービス

```bash
pnpm -C apps/control dev:local:web              # Web / API サーバー
pnpm -C apps/control dev:local:dispatch          # テナントリクエストの dispatch
pnpm -C apps/control dev:local:worker            # バックグラウンドジョブ処理
```

### Host サービス

```bash
pnpm -C apps/control dev:local:runtime-host      # テナントランタイム host
pnpm -C apps/control dev:local:executor-host     # エージェント executor host
pnpm -C apps/control dev:local:browser-host      # ブラウザ自動化 host
```

### OCI Orchestrator

```bash
pnpm -C apps/control local:oci-orchestrator      # コンテナ管理
```

compose を使わない場合は `apps/control/.env.self-host.example` を参考に環境変数を設定する。

## Vectorize（pgvector）の設定

ローカルでセマンティック検索を使うには `PGVECTOR_ENABLED` 環境変数を設定する。

```bash
# .env.local に追加
PGVECTOR_ENABLED=true
```

| 値 | 動作 |
| --- | --- |
| `true` | pgvector を使った Vectorize 互換モードが有効になる |
| 未設定 / `false` | vectorize binding を使う Worker の起動時にエラー |

前提として PostgreSQL に pgvector 拡張がインストールされている必要がある:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Docker の場合は pgvector 対応イメージ（`pgvector/pgvector:pg16`）を使うと楽。

## `.takos-session` ファイル

CLI がローカル環境に自動接続するためのセッションファイル。作業ディレクトリまたは親ディレクトリに配置する。

```json
{
  "session_id": "your-session-id",
  "workspace_id": "your-workspace-id",
  "api_url": "http://localhost:8787"
}
```

| フィールド | 必須 | 説明 |
| --- | --- | --- |
| `session_id` | yes | セッション ID（UUID or 英数字 8-64 文字） |
| `workspace_id` | no | デフォルトの workspace ID |
| `api_url` | no | API エンドポイント URL |

### セキュリティ

- ファイルパーミッションは `600`（owner のみ読み書き）にすること
- パーミッションが不適切な場合、CLI はセッションファイルの読み込みを拒否する
- CLI はカレントディレクトリから親ディレクトリに向かって `.takos-session` を探索する

```bash
# パーミッションの設定
chmod 600 .takos-session
```

### 環境変数による認証

`.takos-session` の代わりに環境変数でも認証できる:

| 変数 | 用途 |
| --- | --- |
| `TAKOS_SESSION_ID` | セッション ID |
| `TAKOS_TOKEN` | PAT（Personal Access Token） |
| `TAKOS_WORKSPACE_ID` | デフォルトの workspace ID |
| `TAKOS_API_URL` | API エンドポイント URL |

優先順位: `TAKOS_SESSION_ID` > `TAKOS_TOKEN` > `.takos-session` ファイル > `~/.takos/config.json`

## CLI の接続先切り替え

ローカル環境に CLI を向ける:

```bash
takos endpoint use local
# → http://localhost:8787 に接続
```

その他のプリセット:

```bash
takos endpoint use prod       # https://takos.jp
takos endpoint use staging    # https://test.takos.jp
takos endpoint use https://custom.example.com
```

## 初回マイグレーション

ローカル DB のスキーマを初期化:

```bash
pnpm db:migrate:local
```

## ローカル環境の制限

- Workers-compatible な local adapter を使うが、Cloudflare backend と完全同一ではない
- provider-native な queue consumer / scheduler / workflow semantics は再現しきれない
- vectorize binding には PostgreSQL + pgvector が必要（`PGVECTOR_ENABLED=true`）
- Durable Objects はローカルでは利用不可
- Dispatch Namespace はローカルでは利用不可

詳しくは [環境ごとの差異](/hosting/differences) を参照。

## 次に読むページ

- [セルフホスト](/hosting/self-hosted) --- 本番向けセルフホスト
- [環境ごとの差異](/hosting/differences) --- Cloudflare との違い
- [はじめてのアプリ](/get-started/your-first-app) --- アプリを作ってデプロイ
