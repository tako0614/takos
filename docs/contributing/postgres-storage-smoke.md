# Postgres storage smoke

## Purpose

`/scripts/postgres-storage-smoke.ts` is a safe-by-default smoke check for the
Takosumi storage plugin/adapter boundary:

- `PostgresStorageDriver` can be constructed with a `SqlClient`.
- `StorageMigrationRunner` can compute a dry-run plan over the bundled Postgres
  storage migrations.
- The script prints the migration catalog, SQL previews, and SQL observed by a
  dry-run `SqlClient` without opening a database connection.

## Default behavior

Run from `takos/paas`:

```sh
deno run --config deno.json --allow-env scripts/postgres-storage-smoke.ts
```

The default mode never connects to Postgres. It uses an in-process fake
`SqlClient`, reports all migrations as pending, and performs a read-only driver
transaction against the fake client so the storage SQL path is visible.

## Real database plugin opt-in

A real smoke path is available for storage plugin/operator validation behind
both of these conditions:

```sh
TAKOS_RUN_POSTGRES_SMOKE=1 DATABASE_URL=postgresql://... \
  deno run --config deno.json \
    --allow-env=TAKOS_RUN_POSTGRES_SMOKE,DATABASE_URL,TAKOS_DATABASE_URL \
    --allow-net --allow-read \
    scripts/postgres-storage-smoke.ts
```

In opt-in mode the smoke creates an optional `npm:pg`-backed `SqlClient`,
applies the bundled storage migrations, and performs a read-only transaction
through `PostgresStorageDriver`. The default dry-run path remains
dependency-free and does not open network connections.
