# Docker provider plugin smoke script

> このページでわかること: Docker provider プラグインの smoke テスト手順。

`scripts/docker-provider-smoke.ts` はローカル Docker provider plugin の materialization パス用の safe-by-default smoke エントリポイントです。plugin / adapter 挙動の検証用であり、kernel release gate には含まれません。

## Default dry-run

Docker アクセスなしで実行します。

```sh
deno run --config deno.json --allow-env=TAKOS_RUN_DOCKER_SMOKE scripts/docker-provider-smoke.ts
```

`DenoCommandDockerRunner` を生成せず、Docker も不要で、`LocalDockerProviderMaterializer` の dry-run runner を使います。生成された Docker コマンドと operation status が出力されます。

## Opt-in Docker 実行

実 Docker コマンドを実行するには、明示的に opt-in して run permission を付与します。

```sh
TAKOS_RUN_DOCKER_SMOKE=1 deno run \
  --config deno.json \
  --allow-env=TAKOS_RUN_DOCKER_SMOKE \
  --allow-run=docker \
  scripts/docker-provider-smoke.ts
```

`TAKOS_RUN_DOCKER_SMOKE=1` の場合のみ、`LocalDockerProviderMaterializer` に `DenoCommandDockerRunner` を注入します。一意な network / group suffix を使い、作成された container / network のクリーンアップ手順が出力されます。

実行される実コマンド例。

- `docker network create takos-docker-smoke-<timestamp>`
- `docker image pull busybox:latest`
- `docker container create ... busybox:latest sh -c 'echo takos docker provider smoke'`
- `docker container start <generated-container-name>`
