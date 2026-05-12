# ローカル開発ガイド

このページは **Takos product service set を local に立ち上げる operator / contributor** 向けです。

Docker Compose ベースのローカル開発環境。

## 前提

- Deno 2.x
- Docker (current stable)
- Docker Compose V2

## セットアップ

```bash
deno task --cwd takos/app check
cp .env.local.example .env.local
```

## 起動・停止

```bash
docker compose --env-file .env.local -f compose.local.yml up --build
docker compose --env-file .env.local -f compose.local.yml logs -f
docker compose --env-file .env.local -f compose.local.yml down
```

バックグラウンドで起動したい場合:

```bash
docker compose --env-file .env.local -f compose.local.yml up --build -d
```

## スモークテスト

```bash
deno task doctor
deno task local:config
deno task local:e2e
```

## 主要サービス

| service       | role                                                    |
| ------------- | ------------------------------------------------------- |
| `takos-app`   | OIDC consumer / Web UI / public API gateway             |
| `takosumi`    | generic manifest deploy engine (`POST /v1/deployments`) |
| `takos-agent` | Takos agent execution service                           |
| `takos-git`   | Takos Git hosting service (Smart HTTP / refs / objects) |
| `postgres`    | local persistence for app / Takosumi / Git              |
| `redis`       | local queue/cache backing                               |

## 個別起動

個別 process を直接立ち上げる場合は、各 owning repository (`app/`、`git/`、 `agent/`、`../takosumi/`) の AGENTS.md と
README に従ってください。product shell では compose による current service set を正本にします。

## 既知の差分

local runtime は production target と同一ではありません。provider 固有の挙動は
対象 hosting guide と Takosumi provider docs を確認してください。
