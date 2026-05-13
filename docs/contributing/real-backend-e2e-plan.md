# Plugin-backed infrastructure readiness runbook

> このページでわかること: プラグイン基盤の readiness チェック手順。

`scripts/real-backend-readiness.ts` は、`takos` から実行可能な plugin-backed infrastructure smoke を選別するための no-start readiness ゲートです。これらの smoke は plugin / local adapter 配線のオペレータ proof であり、PaaS kernel の release 基準ではありません。

スクリプトは次を検査します。

- 必須 CLI: `docker` / `docker compose` / `git`
- 任意の `psql` (手動 Postgres 検査用)
- 必須ローカルファイル: `compose.local.yml` / `.env.local.example` / 選択された env ファイル (`TAKOS_LOCAL_ENV_FILE`、default `.env.local`)
- `compose.local.yml` 内の default 未指定 `${VAR}` 参照が、選択された env ファイルに存在すること
- ローカル real backend スタック向けの host port 空き状況
- 実行可能な既存 smoke スクリプトの一覧

Docker / Postgres / Redis / MinIO / Takos サービスを起動することはありません。

## Readiness 実行

```sh
cd takos
deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local,.env.local.example \
  --allow-env=TAKOS_LOCAL_ENV_FILE \
  --allow-run=docker,git,psql \
  --allow-net=127.0.0.1 \
  scripts/real-backend-readiness.ts
```

別の env ファイルを使う場合は `TAKOS_LOCAL_ENV_FILE` を設定し、`--allow-read` にも追加します。

```sh
TAKOS_LOCAL_ENV_FILE=/tmp/takos-local.env deno run \
  --config deno.json \
  --allow-read=compose.local.yml,.env.local.example,/tmp/takos-local.env \
  --allow-env=TAKOS_LOCAL_ENV_FILE \
  --allow-run=docker,git,psql \
  --allow-net=127.0.0.1 \
  scripts/real-backend-readiness.ts
```

## 結果の解釈

- compose ベースの plugin infrastructure smoke を実行するには `docker` と `docker compose` が必要。
- opt-in git source plugin smoke には `git` が必要。
- `psql` は任意。無くても smoke suite はブロックされませんが、手動 DB デバッグが制限されます。
- compose スタック起動前は port チェックが `ok` であることが期待されます。既に Takos スタックが動いていて port が塞がっている場合、readiness 出力は `local health smoke against an already-running stack` を実行可能として表示します。

## Follow-up smoke コマンド

readiness 出力は、実行可能と判定した smoke の具体的なコマンドを表示します。

- compose dry-run checklist: `scripts/compose-smoke.ts`
- opt-in compose plugin infrastructure smoke: `TAKOS_RUN_COMPOSE_SMOKE=1 ...`
- 起動中スタックに対する local health smoke: `scripts/local-smoke.mjs`
- opt-in git source smoke: `TAKOS_RUN_GIT_SMOKE=1 ...`
- opt-in docker provider smoke: `TAKOS_RUN_DOCKER_SMOKE=1 ...`
- Postgres storage dry-run smoke: `scripts/postgres-storage-smoke.ts`

readiness を先に実行し、実環境に合った前提条件を満たす smoke のみを動かしてください。
