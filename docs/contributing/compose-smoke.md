# Compose opt-in smoke script

> このページでわかること: ローカル Docker Compose スタックの smoke テスト手順。

`scripts/compose-smoke.ts` はローカル `compose.local.yml` スタック向けの safe-by-default smoke エントリポイントです。

## Default dry-run

Docker を起動せずチェックリストのみ実行します。

```sh
deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local \
  --allow-env=TAKOS_RUN_COMPOSE_SMOKE,TAKOS_LOCAL_ENV_FILE,TAKOS_COMPOSE_SMOKE_TIMEOUT_MS \
  scripts/compose-smoke.ts
```

必要なサービス、role ラベル、healthcheck、volume、network、docker-socket 配線、default 未指定の compose 環境変数の存在を検証します。`TAKOS_RUN_COMPOSE_SMOKE=1` が無ければ `docker` / `docker compose` は呼び出しません。

別の env ファイルを使う場合は `TAKOS_LOCAL_ENV_FILE=path/to/file` を指定し、`--allow-read` にもそのパスを追加します。

## Opt-in compose 実行

ローカルスタック smoke を実機実行するには、明示的に opt-in して `docker` 実行を許可します。

```sh
TAKOS_RUN_COMPOSE_SMOKE=1 deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local \
  --allow-env \
  --allow-run=docker \
  scripts/compose-smoke.ts
```

有効化すると、生成した compose project 名と最小限の明示的 env で `Deno.Command` を使い、次を順に実行します。

1. `docker compose config`
2. `docker compose up --build -d`
3. `docker compose ps`
4. `docker compose logs --no-color --tail 200`
5. `finally` で `docker compose down --remove-orphans --timeout 10`

各コマンドには timeout が掛かります。default は 300000 ms で、`TAKOS_COMPOSE_SMOKE_TIMEOUT_MS=<milliseconds>` で上書きできます。
