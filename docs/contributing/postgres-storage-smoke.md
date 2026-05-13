# Postgres storage smoke

> このページでわかること: Postgres storage プラグインの smoke テスト。

## 目的

`/scripts/postgres-storage-smoke.ts` は Takosumi storage plugin / adapter 境界の safe-by-default smoke です。

- `PostgresStorageDriver` を `SqlClient` で生成できる。
- `StorageMigrationRunner` が、同梱の Postgres storage migration に対する dry-run plan を計算できる。
- migration カタログ、SQL プレビュー、および dry-run `SqlClient` が観測する SQL を、DB 接続なしに出力。

## Default 挙動

`takos` で実行します。

```sh
deno run --config deno.json --allow-env scripts/postgres-storage-smoke.ts
```

default は Postgres に接続しません。in-process の fake `SqlClient` を使い、全 migration を pending として報告し、fake client に対して driver の read-only transaction を流して storage SQL パスを可視化します。

## 実 DB plugin の opt-in

storage plugin / operator 検証用の real smoke は次の両方が必要です。

```sh
TAKOS_RUN_POSTGRES_SMOKE=1 DATABASE_URL=postgresql://... \
  deno run --config deno.json \
    --allow-env=TAKOS_RUN_POSTGRES_SMOKE,DATABASE_URL,TAKOS_DATABASE_URL \
    --allow-net --allow-read \
    scripts/postgres-storage-smoke.ts
```

opt-in モードでは optional な `npm:pg` ベースの `SqlClient` を生成し、同梱の storage migration を適用し、`PostgresStorageDriver` 経由で read-only transaction を実行します。default の dry-run パスは依存ゼロでネットワーク接続を行いません。
