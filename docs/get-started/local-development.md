# ローカル開発ガイド

Docker Compose ベースのローカル開発環境。

## 前提

Node.js 20+ / pnpm 9+ / Docker (current stable) / Docker Compose V2

## セットアップ

```bash
corepack pnpm install
cp .env.local.example .env.local
```

## 起動・停止

```bash
corepack pnpm local:up        # 起動（foreground）
corepack pnpm local:logs       # ログ確認
corepack pnpm local:down       # 停止
```

バックグラウンドで起動したい場合:
```bash
docker compose --env-file .env.local -f compose.local.yml up --build -d
```

## スモークテスト

```bash
corepack pnpm local:smoke              # 全体の疎通確認
corepack pnpm local:proxyless-smoke    # CF 固有 path の逆流チェック
```

## 主要サービス

| service | role |
| --- | --- |
| `control-web` | web/API worker |
| `control-dispatch` | tenant dispatch |
| `control-worker` | background worker |
| `runtime-host` / `runtime` | tenant runtime |
| `executor-host` / `rust-agent` | agent executor |
| `browser-host` / `browser` | browser automation |
| `postgres` / `redis` / `minio` | infra backing services |

## 個別起動

```bash
corepack pnpm -C apps/control dev:local:web
corepack pnpm -C apps/control dev:local:dispatch
corepack pnpm -C apps/control dev:local:worker
```

compose を使わない場合は `apps/control/.env.self-host.example` を参考に。

## 既知の差分

local runtime は Workers-compatible を目指すが完全一致ではない。詳しくは [互換性と制限](/architecture/compatibility) を参照。
