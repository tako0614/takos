# Real Docker Compose smoke harness

> このページでわかること: 実 Docker Compose スタックの opt-in smoke テスト。

`scripts/compose-real-smoke.ts` は、ローカル `compose.local.yml` スタックを実機で検証するための opt-in ハーネスです。`TAKOS_RUN_REAL_COMPOSE_SMOKE=1` が無い場合は skip サマリを出力して `0` で終了し、Docker / compose config 生成 / コンテナ起動を一切行いません。

## Default safe モード

```sh
deno run \
  --config deno.json \
  --allow-env=TAKOS_RUN_REAL_COMPOSE_SMOKE,TAKOS_KEEP_COMPOSE_SMOKE,TAKOS_LOCAL_ENV_FILE,TAKOS_REAL_COMPOSE_SMOKE_TIMEOUT_MS,TAKOS_REAL_COMPOSE_SMOKE_POLL_INTERVAL_MS \
  scripts/compose-real-smoke.ts
```

期待結果: skip / safe サマリと exit `0`。

## Opt-in real モード

```sh
TAKOS_RUN_REAL_COMPOSE_SMOKE=1 deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local \
  --allow-env \
  --allow-run=docker \
  --allow-net=127.0.0.1 \
  scripts/compose-real-smoke.ts
```

ハーネスは生成した compose project 名を使い、次の手順を実行します。

1. Docker daemon と `docker compose` の利用可否をチェック。
2. `docker compose config` をレンダリング。
3. 利用可能なら `docker compose up --build --wait` を優先。
4. fallback として `docker compose up --build -d` + `docker compose ps --format json` で health polling。
5. compose service の state / health と localhost `/health` を検証。
6. cleanup で `docker compose down --remove-orphans --timeout 10` を実行。

`TAKOS_KEEP_COMPOSE_SMOKE=1` を real モードと組み合わせると、検査用に compose project を残せます。コマンド全体の timeout は default `600000` ms (`TAKOS_REAL_COMPOSE_SMOKE_TIMEOUT_MS` で変更可)、fallback health polling 間隔は default `5000` ms (`TAKOS_REAL_COMPOSE_SMOKE_POLL_INTERVAL_MS` で変更可) です。

## ローカル実行記録

2026-04-28 に `TAKOS_RUN_REAL_COMPOSE_SMOKE=1` で opt-in 実行を行いました。ローカルの service set は `takos-app` / `takosumi` / `takos-git` / `takos-agent` の 4 つで、本番証拠として扱う前にこの set に対する evidence を更新する必要があります。
