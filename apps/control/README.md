# apps/control

Cloudflare Workers deployment application serving as the entry point for the
Takos control plane. Each source file is a thin Wrangler entry point that
re-exports from the `takos-control` package, keeping deployment configuration
separate from business logic.

This directory is the tracked OSS deployment template and local/self-host
reference. Production and staging operations are centralized in
`takos-private/`.

## Worker types

| Worker            | Entry point            | Wrangler config              | Description                                                                |
| ----------------- | ---------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| **Web**           | `src/web.ts`           | `wrangler.toml`              | Main web worker: admin API, user-facing APIs                               |
| **Background**    | `src/worker.ts`        | `wrangler.worker.toml`       | Queue processing: run dispatch, indexing, workflow execution, egress proxy |
| **Dispatch**      | `src/dispatch.ts`      | `wrangler.dispatch.toml`     | Dispatch namespace for tenant request routing                              |
| **Executor host** | `src/executor-host.ts` | `wrangler.executor.toml`     | Manages agent executor container lifecycle                                 |
| **Runtime host**  | `src/runtime-host.ts`  | `wrangler.runtime-host.toml` | Hosts the takos-runtime-service container lifecycle                        |

All entry points follow the same pattern:

```ts
export * from "takos-control/core/web";
export { default } from "takos-control/core/web";
```

The actual implementation lives in `packages/control/`.

## Deployment

Each worker is deployed independently via its own Wrangler config. The commands
below are for the tracked template or local/self-host verification only; use
`takos-private/` for actual production and staging operations:

- `deploy:service <service> production` deploys the base Wrangler config as-is
  and does not pass `--env production`
- `deploy:service <service> staging` targets the `[env.staging]` overlay with
  `--env staging`

```sh
# Deploy the main web worker in the tracked template / self-host reference
cd takos && deno task --cwd apps/control deploy:service web staging

# Deploy the background worker in the tracked template / self-host reference
cd takos && deno task --cwd apps/control deploy:service worker staging
```

Production and staging deployments are managed from `takos-private/`. Do not
deploy directly from this directory in production.

## Database migrations

Database migrations are managed with [Drizzle](https://orm.drizzle.team/) and
stored in `db/migrations/`. The migration config is defined in
`drizzle.config.ts`. The local/self-host PostgreSQL compatibility backend
applies these migrations at service startup; `db:migrate` is for Wrangler's
local D1 backend.

```sh
# Generate a new migration
cd takos && deno task --cwd apps/control db:generate

# Apply migrations
cd takos && deno task --cwd apps/control db:migrate
```

## Testing

Tests live in `src/__tests__/` and cover routes, services, middleware, queues,
container hosts, durable objects, and more.

```sh
cd takos && deno test --allow-all apps/control/src/__tests__/
```
