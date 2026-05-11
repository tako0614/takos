# ローカル開発ガイド

::: warning このページは operator 向け `.takosumi/manifest.yml` を書きたい **deploy manifest author**
はこのページを読む必要はありません。migration window 中の Takos compatibility surface を使う場合は `takos login` で
managed Takos endpoint に認証して `takos deploy --space SPACE_ID --group GROUP_NAME` します。

このページは **Takosumi kernel 自体を local に立ち上げる operator** 向けです。 :::

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

local runtime は Workers-compatible を目指すが完全一致ではない。詳しくは
[互換性と制限](https://github.com/tako0614/takosumi/blob/master/docs/reference/compatibility.md) を参照。
