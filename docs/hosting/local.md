# ローカル開発

> このページでわかること: Docker Compose で Takos
> のローカル開発環境を立ち上げる方法。

Cloudflare アカウントなしでローカルに Takos を動かせます。

::: info これは production deploy target ではありませんローカル開発は
`distribution.yml` の `kernel_host.target` には含めません (5 target =
`cloudflare` / `aws` / `gcp` / `kubernetes` / `selfhosted`)。本番 deploy target
として bare metal / VM を使う場合は [Self-hosted](/hosting/self-hosted)
(`selfhosted`) を選んでください。 :::

## 前提

- Bun
- Docker（current stable）
- Docker Compose V2

## セットアップ

```bash
bun run check
cp .env.local.example .env.local
```

## 起動・停止

```bash
bun run local:up        # 起動（foreground）
bun run local:logs      # ログ確認
bun run local:down      # 停止
```

compose project 名は既定で `takos-local` です。既存 stack と分離したい場合は
`TAKOS_LOCAL_COMPOSE_PROJECT=<name>` を指定します。

バックグラウンドで起動したい場合:

```bash
docker compose --env-file .env.local -p takos-local -f compose.local.yml up --build -d
```

## スモークテスト

```bash
bun run local:smoke              # 全体の疎通確認
bun run local:e2e                # isolated compose e2e + Smart HTTP git clone
```

### `bun run local:e2e` とは

isolated compose project を起動し、health checks、takos-worker 経由の Smart HTTP git
clone、主要 service の疎通を確認する CI 用 smoke です。

## 主要サービス

| サービス      | ポート  | 役割                                        |
| ------------- | ------- | ------------------------------------------- |
| `takos-worker` | `8787`  | OIDC consumer / Web UI / public API / queue / scheduled Worker |
| `takosumi`    | `8788`  | Source resolution / Installation / Deployment ledger engine |
| `takos-agent` | `8789`  | agent execution service                     |
| `takos-git`   | `8790`  | Git hosting service                         |
| `postgres`    | `15432` | PostgreSQL                                  |
| `redis`       | `16379` | Redis（queue/cache backing）                |

local での user-defined app workload 実行は Takosumi installer / kernel と
runtime-agent handler 経由で扱います。Source resolution、PlatformService inventory
binding resolution、Deployment evidence recording は `takosumi`、infra provisioning
は operator-owned workflow、build は build service / CI、Git hosting は `takos-git`、agent
実行は `takos-agent` の責務です。

private server stack の基準は `takos-private/`
で、`takos-private/.env.server.example`、`takos-private/compose.server.yml`、
`takos/containers/agent/Dockerfile` を使います。OSS local stack は `./.env.local.example`
と `compose.local.yml` を使い、private 側は sibling checkout で別管理です。

### ローカル service target override

通常は `compose.local.yml` / `.env.local.example` の既定値を使う。個別の owning
service だけを外部プロセスへ逃がす場合は、compose env の internal URL
を明示する。

| 変数                       | 用途                                                 |
| -------------------------- | ---------------------------------------------------- |
| `TAKOSUMI_INTERNAL_URL`    | takos-worker から Takosumi kernel への internal URL     |
| `TAKOS_GIT_INTERNAL_URL`   | takos-worker から Takos Git hosting への internal URL   |
| `TAKOS_AGENT_INTERNAL_URL` | takos-worker から Takos agent service への internal URL |

```bash
TAKOSUMI_INTERNAL_URL=http://127.0.0.1:8788
```

## 個別起動

compose を使わずに個別にサービスを起動する場合は、各 owning repository の
AGENTS.md / README に従います。

private server stack を構成する場合は `takos-private/.env.server.example` と
`takos-private/compose.server.yml` を参考に環境変数を設定する。

## Vectorize（pgvector）の設定

ローカルでセマンティック検索を使うには `PGVECTOR_ENABLED` 環境変数を設定する。

```bash
# .env.local に追加
PGVECTOR_ENABLED=true
```

| 値               | 動作                                                |
| ---------------- | --------------------------------------------------- |
| `true`           | pgvector を使った semantic search mode が有効になる |
| 未設定 / `false` | vectorize binding を使う Worker の起動時にエラー    |

前提として PostgreSQL に pgvector 拡張がインストールされている必要がある:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Docker の場合は pgvector 対応イメージ（`pgvector/pgvector:pg16`）を使うと楽。

## 初回マイグレーション

`compose.local.yml` の PostgreSQL backend は起動時に
`takos/db/migrations-control/migrations` を self-host migration runner
で自動適用する。手動で以下を実行する必要はない。

Wrangler の local D1 backend を単体で使う場合だけ、`db/migrations-control/migrations`
を migration source として Wrangler 側から適用する。

## ローカル環境の制限

- backend に依存しないデプロイ仕様をローカル backend 上で再現しますが、 tracked
  reference の Workers backend と完全同一ではありません
- backend 固有の queue consumer / scheduler / workflow
  セマンティクスは完全には再現できません。 queue binding
  の基本配信は動作しますが、backend 固有のトリガー動作はターゲットの runtime
  runtime handler の制約に従います
- vectorize binding には PostgreSQL + pgvector が必要です
  (`PGVECTOR_ENABLED=true`)
- Durable Object binding は永続的なローカルランタイムで利用できますが、 tracked
  reference の Workers backend と byte-for-byte 一致するものではありません
- Dispatch Namespace は提供されず、tenant runtime path を使用します

詳細は [環境ごとの差異](/hosting/differences) を参照してください。

## 次に読むページ

- [セルフホスト](/hosting/self-hosted) --- 本番向けセルフホスト
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [はじめての app](/get-started/your-first-app) --- app を作ってデプロイ
