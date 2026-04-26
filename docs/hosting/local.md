# ローカル開発

Docker Compose ベースのローカル開発環境。Cloudflare アカウントなしで Takos
tenant runtime の local backend を動かせる。

## 前提

- Deno
- Docker（current stable）
- Docker Compose V2

## セットアップ

```bash
deno task build:all
cp .env.local.example .env.local
```

## 起動・停止

```bash
deno task local:up        # 起動（foreground）
deno task local:logs      # ログ確認
deno task local:down      # 停止
```

バックグラウンドで起動したい場合:

```bash
docker compose --env-file .env.local -f compose.local.yml up --build -d
```

## スモークテスト

```bash
deno task local:smoke              # 全体の疎通確認
deno task local:proxyless-smoke    # CF 固有 path の逆流チェック
```

### `deno task local:proxyless-smoke` とは

Cloudflare backend
固有のルーティングパスがローカル環境で意図せず「逆流」しないかを確認するテスト。セルフホスト環境で
Cloudflare 依存のルーティングが紛れ込んでいないかを検証する。

## 主要サービス

| サービス           | ポート            | 役割                                          |
| ------------------ | ----------------- | --------------------------------------------- |
| `control-web`      | `8787`            | Web / API worker                              |
| `control-dispatch` | `8788`            | テナント dispatch                             |
| `control-worker`   | -                 | バックグラウンド worker                       |
| `runtime-host`     | `8789`            | runtime-service host / compatibility endpoint |
| `runtime`          | `8081`            | `takos-runtime-service` container             |
| `executor-host`    | `8790`            | エージェント executor の control-plane host   |
| `takos-agent`       | `8082`            | エージェント executor container               |
| `oci-orchestrator` | `9002`            | コンテナライフサイクル管理                    |
| `postgres`         | `15432`           | PostgreSQL（D1 互換）                         |
| `redis`            | `16379`           | Redis（queue / durable runtime の backing）   |
| `minio`            | `19000` / `19001` | MinIO（R2 互換）                              |

`runtime-host` / `executor-host` は `TAKOS_LOCAL_RUNTIME_URL` /
`TAKOS_LOCAL_EXECUTOR_URL` で backing container に forward する。OSS local stack
の既定値は `.env.local.example` を使う。

runtime-service JWT は `PLATFORM_PRIVATE_KEY` で署名し、`JWT_PUBLIC_KEY` で検証
する。local stack では runtime container も同じ env file を読むため、
`JWT_PUBLIC_KEY` には `PLATFORM_PUBLIC_KEY` と同じ公開鍵を設定する。Cloudflare
Container 構成では runtime-host が `PLATFORM_PUBLIC_KEY` を container env の
`JWT_PUBLIC_KEY` として渡す。

local での user-defined group workload 実行は tenant runtime compatibility path
で行い、内部では `control-dispatch` から Workers-compatible local adapter が
`worker-bundle` を materialize する。`runtime` container は sandbox shell /
workflow job / git / CLI proxy 用の `takos-runtime-service` であり、任意の user
app container ではない。image-backed Service / Attached Container は
`oci-orchestrator` が扱う。

private server stack の基準は `takos-private/`
で、`takos-private/.env.server.example`、`takos-private/compose.server.yml`、
`agent/Dockerfile`
を使います。OSS local stack は `./.env.local.example` と `compose.local.yml`
を使い、private 側は sibling checkout で別管理です。

### ローカル service target override

通常は `compose.local.yml` / `.env.local.example` の既定値を使う。個別の host
service だけを外部プロセスへ逃がす場合は、local dispatch resolver の escape
hatch として次を使える。

| 変数                                | 用途                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `TAKOS_LOCAL_DISPATCH_TARGETS_JSON` | infra service target の URL map。tenant worker は上書き不可 |
| `TAKOS_LOCAL_RUNTIME_URL`           | `runtime-host` service target の shorthand                  |
| `TAKOS_LOCAL_EXECUTOR_URL`          | `executor-host` service target の shorthand                 |
| `TAKOS_LOCAL_EGRESS_URL`            | `takos-egress` service target の shorthand                  |
| `TAKOS_RUNTIME_HOST_URL`            | `runtime-host` service target の alias                      |
| `TAKOS_EXECUTOR_HOST_URL`           | `executor-host` service target の alias                     |
| `TAKOS_EGRESS_URL`                  | `takos-egress` service target の fallback shorthand         |

```bash
TAKOS_LOCAL_DISPATCH_TARGETS_JSON='{"runtime-host":"http://127.0.0.1:8789"}'
```

## 個別起動

compose を使わずに個別にサービスを起動する場合。事前に PostgreSQL / Redis /
MinIO が起動している前提。

### Control Plane サービス

```bash
deno task --cwd apps/control dev:local:web       # Web / API サーバー
deno task --cwd apps/control dev:local:dispatch  # テナントリクエストの dispatch
deno task --cwd apps/control dev:local:worker    # バックグラウンドジョブ処理
```

### Host サービス

```bash
deno task --cwd apps/control dev:local:runtime-host   # runtime-service host
deno task --cwd apps/control dev:local:executor-host  # エージェント executor host
```

### OCI Orchestrator

```bash
deno task --cwd apps/control dev:local:oci-orchestrator  # コンテナ管理
```

private server stack を構成する場合は `takos-private/.env.server.example` と
`takos-private/compose.server.yml` を参考に環境変数を設定する。

## Vectorize（pgvector）の設定

ローカルでセマンティック検索を使うには `PGVECTOR_ENABLED` 環境変数を設定する。

```bash
# .env.local に追加
PGVECTOR_ENABLED=true
```

| 値               | 動作                                               |
| ---------------- | -------------------------------------------------- |
| `true`           | pgvector を使った Vectorize 互換モードが有効になる |
| 未設定 / `false` | vectorize binding を使う Worker の起動時にエラー   |

前提として PostgreSQL に pgvector 拡張がインストールされている必要がある:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Docker の場合は pgvector 対応イメージ（`pgvector/pgvector:pg16`）を使うと楽。

## `.takos-session` ファイル

CLI
がローカル環境に自動接続するためのセッションファイル。作業ディレクトリまたは親ディレクトリに配置する。

```json
{
  "session_id": "your-session-id",
  "space_id": "your-space-id",
  "api_url": "http://localhost:8787"
}
```

| フィールド   | 必須 | 説明                                      |
| ------------ | ---- | ----------------------------------------- |
| `session_id` | yes  | セッション ID（UUID or 英数字 8-64 文字） |
| `space_id`   | no   | デフォルトの space ID                     |
| `api_url`    | no   | API エンドポイント URL                    |

### セキュリティ

- ファイルパーミッションは `600`（owner のみ読み書き）にすること
- パーミッションが不適切な場合、CLI はセッションファイルの読み込みを拒否する
- CLI はカレントディレクトリから親ディレクトリに向かって `.takos-session`
  を探索する

```bash
# パーミッションの設定
chmod 600 .takos-session
```

### 環境変数による認証

`.takos-session` の代わりに環境変数でも認証できる:

| 変数               | 用途                         |
| ------------------ | ---------------------------- |
| `TAKOS_SESSION_ID` | セッション ID                |
| `TAKOS_TOKEN`      | PAT（Personal Access Token） |
| `TAKOS_SPACE_ID`   | デフォルトの space ID        |
| `TAKOS_API_URL`    | API エンドポイント URL       |

優先順位: `TAKOS_SESSION_ID` > `TAKOS_TOKEN` > `.takos-session` ファイル >
`~/.takos/config.json`

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

`compose.local.yml` の PostgreSQL backend は起動時に
`apps/control/db/migrations` を self-host migration runner で自動適用する。
手動で以下を実行する必要はない。

Wrangler の local D1 backend を単体で使う場合だけ、同じ migration source
に対して 次を実行する:

```bash
deno task --cwd apps/control db:migrate
```

## ローカル環境の制限

- backend-neutral deploy spec を local backend 上で実現するが、Cloudflare
  backend と完全同一ではない
- backend-specific な queue consumer / scheduler / workflow semantics
  は再現しきれない。queue binding の basic delivery は動かせるが、
  `triggers.queues` の deploy は `workers-dispatch` backend 必須で、local
  `runtime-host` では fail-fast する
- vectorize binding には PostgreSQL + pgvector が必要（`PGVECTOR_ENABLED=true`）
- Durable Object binding は persistent local runtime で利用できるが、Cloudflare
  backend と byte-for-byte 同一ではない
- Dispatch Namespace は提供されず、tenant runtime compatibility path を使う

詳しくは [環境ごとの差異](/hosting/differences) を参照。

## 次に読むページ

- [セルフホスト](/hosting/self-hosted) --- 本番向けセルフホスト
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [はじめての group](/get-started/your-first-app) --- group を作ってデプロイ
