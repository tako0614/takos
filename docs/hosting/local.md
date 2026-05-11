# ローカル開発

Docker Compose ベースのローカル開発環境。Cloudflare アカウントなしで Takos
tenant runtime の local backend を動かせる。

::: info これは production deploy target ではありません ローカル開発は
`distribution.yml` の `kernel_host.target` には含めません (5 target =
`cloudflare` / `aws` / `gcp` / `kubernetes` / `selfhosted`)。本番 deploy target
として bare metal / VM を使う場合は [Self-hosted](/hosting/self-hosted)
(`selfhosted`) を選んでください。 :::

## 前提

- Deno
- Docker（current stable）
- Docker Compose V2

## セットアップ

```bash
deno task doctor
cp .env.local.example .env.local
```

## 起動・停止

```bash
deno task local:up        # 起動（foreground）
deno task local:logs      # ログ確認
deno task local:down      # 停止
```

compose project 名は既定で `takos-local` です。既存 stack と分離したい場合は
`TAKOS_LOCAL_COMPOSE_PROJECT=<name>` を指定します。

バックグラウンドで起動したい場合:

```bash
docker compose --env-file .env.local -p takos-local -f compose.local.yml up --build -d
```

## スモークテスト

```bash
deno task local:smoke              # 全体の疎通確認
deno task local:proxyless-smoke    # CF 固有 path の逆流チェック
```

### `deno task local:proxyless-smoke` とは

tracked reference Workers backend
固有のルーティングパスがローカル環境で意図せず「逆流」しないかを確認するテスト。セルフホスト環境で
Cloudflare 依存のルーティングが紛れ込んでいないかを検証する。

## 主要サービス

| サービス           | ポート            | 役割                                          |
| ------------------ | ----------------- | --------------------------------------------- |
| `takos-app`        | `8787`            | OIDC consumer / Web UI / public API gateway   |
| `takosumi`         | `8788`            | generic manifest deploy engine                |
| `takos-agent`      | `8789`            | agent execution service                       |
| `takos-git`        | `8790`            | Git hosting service                           |
| `postgres`         | `15432`           | PostgreSQL                                    |
| `redis`            | `16379`           | Redis（queue/cache backing）                  |

local での user-defined group workload 実行は Takosumi kernel の manifest
deploy engine と provider/runtime-agent connector 経由で扱います。workflow build
や `workflowRef` 解決は `takosumi-git`、Git hosting は `takos-git`、agent 実行は
`takos-agent` の責務です。旧 `control-dispatch` / `runtime-host` /
`takos-runtime-service` を current service id として扱いません。

private server stack の基準は `takos-private/`
で、`takos-private/.env.server.example`、`takos-private/compose.server.yml`、
`takos/agent/Dockerfile` を使います。OSS local stack は `./.env.local.example`
と `compose.local.yml` を使い、private 側は sibling checkout で別管理です。

### ローカル service target override

通常は `compose.local.yml` / `.env.local.example` の既定値を使う。個別の owning
service だけを外部プロセスへ逃がす場合は、compose env の internal URL を明示する。

| 変数                                | 用途                                                        |
| ----------------------------------- | ----------------------------------------------------------- |
| `TAKOSUMI_INTERNAL_URL`             | takos-app から Takosumi kernel への internal URL            |
| `TAKOS_GIT_INTERNAL_URL`            | takos-app から Takos Git hosting への internal URL          |
| `TAKOS_AGENT_INTERNAL_URL`          | takos-app から Takos agent service への internal URL        |

```bash
TAKOSUMI_INTERNAL_URL=http://127.0.0.1:8788
```

## 個別起動

compose を使わずに個別にサービスを起動する場合は、各 owning repository の
AGENTS.md / README に従います。Takos product shell docs では旧
`control-*` / `runtime-host` process role を current service として扱いません。

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
`takos/app/apps/control/db/migrations` を self-host migration runner で自動適用
する。手動で以下を実行する必要はない。

Wrangler の local D1 backend を単体で使う場合だけ、同じ migration source
に対して 次を実行する:

```bash
cd takos/app/apps/control && deno task db:migrate
```

## ローカル環境の制限

- backend-neutral deploy spec を local backend 上で実現するが、tracked reference
  Workers backend と完全同一ではない
- backend-specific な queue consumer / scheduler / workflow semantics
  は再現しきれない。queue binding の basic delivery は動かせるが、
  backend-specific trigger behavior は target runtime connector の制限に従う
- vectorize binding には PostgreSQL + pgvector が必要（`PGVECTOR_ENABLED=true`）
- Durable Object binding は persistent local runtime で利用できるが、tracked
  reference Workers backend と byte-for-byte 同一ではない
- Dispatch Namespace は提供されず、tenant runtime compatibility path を使う

詳しくは [環境ごとの差異](/hosting/differences) を参照。

## 次に読むページ

- [セルフホスト](/hosting/self-hosted) --- 本番向けセルフホスト
- [環境ごとの差異](/hosting/differences) --- 全環境の比較
- [はじめての group](/get-started/your-first-app) --- group を作ってデプロイ
