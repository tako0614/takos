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

## 主要サービス

| サービス | 役割 |
| --- | --- |
| `control-web` | Web / API worker |
| `control-dispatch` | テナント dispatch |
| `control-worker` | バックグラウンド worker |
| `runtime-host` / `runtime` | テナントランタイム |
| `executor-host` / `executor` | エージェント executor |
| `browser-host` / `browser` | ブラウザ自動化 |
| `postgres` / `redis` / `minio` | インフラ backing services |

## 個別起動

compose を使わずに個別に起動する場合:

```bash
pnpm -C apps/control dev:local:web
pnpm -C apps/control dev:local:dispatch
pnpm -C apps/control dev:local:worker
```

compose を使わない場合は `apps/control/.env.self-host.example` を参考に環境変数を設定する。

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

## ローカル環境の制限

- Workers-compatible な local adapter を使うが、Cloudflare backend と完全同一ではない
- provider-native な queue consumer / scheduler / workflow semantics は再現しきれない
- vectorize binding には PostgreSQL + pgvector が必要（`PGVECTOR_ENABLED=true`）

詳しくは [環境ごとの差異](/hosting/differences) を参照。

## 次に読むページ

- [セルフホスト](/hosting/self-hosted) --- 本番向けセルフホスト
- [環境ごとの差異](/hosting/differences) --- Cloudflare との違い
- [はじめてのアプリ](/get-started/your-first-app) --- アプリを作ってデプロイ
