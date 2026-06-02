# SQL Storage Proof

> このページでわかること: SQL storage / migration surface の current proof。

Takos product は Cloudflare D1 / SQL binding を current deploy target
として扱います。 Takosumi kernel の storage catalog / migration behavior は
Takosumi tests で検証します。

```sh
cd ../takosumi
bun test \
  src/service/adapters/storage/catalog_test.ts \
  src/service/adapters/storage/migration-runner/mod_test.ts \
  src/service/adapters/storage/migration-runner/rollback_test.ts
```

Takos app の DB-facing control code は product workspace tests で確認します。

```sh
cd takos
bun run test
```

Provider-owned live database proof は `takos-private` managed-offering readiness
evidence または distribution target evidence に添付します。
