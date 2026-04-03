# apps/control

Cloudflare Workers deployment application serving as the entry point for the Takos control plane. Each source file is a thin Wrangler entry point that re-exports from the `takos-control` package, keeping deployment configuration separate from business logic.

## Worker types

| Worker | Entry point | Wrangler config | Description |
|---|---|---|---|
| **Web** | `src/web.ts` | `wrangler.toml` | Main web worker: admin API, user-facing APIs |
| **Background** | `src/worker.ts` | `wrangler.worker.toml` | Queue processing: run dispatch, indexing, workflow execution, egress proxy |
| **Dispatch** | `src/dispatch.ts` | `wrangler.dispatch.toml` | Dispatch namespace for tenant request routing |
| **Executor host** | `src/executor-host.ts` | `wrangler.executor.toml` | Manages agent executor container lifecycle |
| **Runtime host** | `src/runtime-host.ts` | `wrangler.runtime-host.toml` | Manages runtime container lifecycle |
| **Browser host** | `src/browser-host.ts` | `wrangler.browser-host.toml` | Manages browser session container lifecycle |

All entry points follow the same pattern:

```ts
export * from 'takos-control/core/web';
export { default } from 'takos-control/core/web';
```

The actual implementation lives in `packages/control/`.

## Deployment

Each worker is deployed independently via its own Wrangler config:

```sh
# Deploy the main web worker
cd takos && npx wrangler deploy -c apps/control/wrangler.toml

# Deploy the background worker
cd takos && npx wrangler deploy -c apps/control/wrangler.worker.toml
```

Production and staging deployments are managed from `takos-private/`. Do not deploy directly from this directory in production.

## Database migrations

Database migrations are managed with [Drizzle](https://orm.drizzle.team/) and stored in `db/migrations/`. The migration config is defined in `drizzle.config.ts`.

```sh
# Generate a new migration
cd takos && npx drizzle-kit generate --config apps/control/drizzle.config.ts

# Apply migrations
cd takos && npx drizzle-kit migrate --config apps/control/drizzle.config.ts
```

## Testing

Tests live in `src/__tests__/` and cover routes, services, middleware, queues, container hosts, durable objects, and more.

```sh
cd takos && deno test --allow-all apps/control/src/__tests__/
```
