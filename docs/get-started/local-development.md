# ローカル開発ガイド

::: warning このページは operator 向け `.takos/app.yml` を書きたい **deploy
manifest author** はこのページを読む必要はありません。`takos login` で managed
Takos endpoint に認証して `takos deploy --space SPACE_ID --group GROUP_NAME`
するだけで開発できます。

このページは **Takos kernel 自体を local に立ち上げる operator** 向けです。
:::

Docker Compose ベースのローカル開発環境。

## 前提

- Deno 2.x
- Docker (current stable)
- Docker Compose V2

## セットアップ

```bash
deno task build:all
cp .env.local.example .env.local
```

## 起動・停止

```bash
deno task local:up             # 起動（foreground）
deno task local:logs           # ログ確認
deno task local:down           # 停止
```

バックグラウンドで起動したい場合:

```bash
docker compose --env-file .env.local -f compose.local.yml up --build -d
```

## スモークテスト

```bash
deno task local:smoke                  # 全体の疎通確認
deno task local:proxyless-smoke        # CF 固有 path の逆流チェック
```

## 主要サービス

| service                        | role                             |
| ------------------------------ | -------------------------------- |
| `control-web`                  | web/API worker                   |
| `control-dispatch`             | tenant dispatch                  |
| `control-worker`               | background worker                |
| `runtime-host` / `runtime`     | runtime-service host / container |
| `executor-host` / `rust-agent` | agent executor                   |
| `postgres` / `redis` / `minio` | infra backing services           |

## 個別起動

```bash
deno task --cwd apps/control dev:local:web
deno task --cwd apps/control dev:local:dispatch
deno task --cwd apps/control dev:local:worker
```

compose を使わない場合は `apps/control/.env.self-host.example` を参考に。

## 既知の差分

local runtime は Workers-compatible を目指すが完全一致ではない。詳しくは
[互換性と制限](/architecture/compatibility) を参照。
