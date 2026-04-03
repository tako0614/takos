# takos-control

Core control plane and administration service for the Takos platform. This is
the largest package in the monorepo, providing the web admin worker, tenant
dispatch worker, AI agent execution, Git Smart HTTP v2, source/manifest
management, platform adapters (Cloudflare Workers, Node.js), runtime
orchestration (workers, queues, durable objects), OAuth2/ActivityPub
integration, and the full REST API surface.

## Architecture

The package is organized into layered domains:

```
src/
  index.ts                     -- re-exports from web.ts
  web.ts                       -- Hono web worker (admin domain)
  dispatch.ts                  -- Hono dispatch worker (tenant domains)
  application/
    services/
      agent/                   -- AI agent execution (LangGraph, MCP)
      git-smart/               -- Git Smart HTTP v2 protocol
      source/                  -- Source code + app manifest handling
      routing/                 -- Hostname-to-worker routing resolution
      cloudflare/              -- Cloudflare API client
      deployment/              -- Group deployment orchestration
      identity/                -- User identity management
      oauth/                   -- OAuth2 Authorization Server
      activitypub/             -- ActivityPub federation
      threads/                 -- Thread/discussion system
      billing/                 -- Billing and plan management
      notifications/           -- Notification delivery
      maintenance/             -- Scheduled maintenance jobs
      r2/                      -- R2 object storage operations
      memory/                  -- Agent memory subsystem
      memory-graph/            -- Graph-based memory retrieval
      pull-requests/           -- Pull request management
      workflow-runs/           -- GitHub Actions workflow orchestration
      wfp/                     -- Workflow platform client
      ...
  server/
    routes/
      api.ts                   -- Main API router (/api prefix)
      auth/                    -- Auth routes (login, session, CLI, link)
      oauth/                   -- OAuth2 endpoints
      well-known.ts            -- .well-known endpoints
      activitypub-store/       -- ActivityPub store routes
      profiles/                -- /@username profile routes
      smart-http.ts            -- Git Smart HTTP route bindings
      rpc-types.ts             -- RPC type definitions
    middleware/
      auth.ts                  -- requireAuth / optionalAuth
      static-assets.ts         -- Static asset serving
  platform/
    platform-config.ts         -- ControlPlatform type definition
    context.ts                 -- Hono context platform injection
    accessors.ts               -- getPlatformConfig / getPlatformServices
    adapters/
      workers.ts               -- Cloudflare Workers platform builder
      node.ts                  -- Node.js platform builder
      shared.ts                -- Shared adapter utilities
    providers/
      cloudflare/              -- CF-specific service implementations
      node/                    -- Node-specific service implementations
  runtime/
    worker/                    -- Worker runtime management
    runner/                    -- Job runner + queue/cron handlers
    indexer/                   -- Source indexing runtime
    executor-proxy-api.ts      -- Executor RPC proxy
    durable-objects/           -- CF Durable Object implementations
    queues/                    -- Queue processing
    container-hosts/           -- Container host management
  shared/
    types/                     -- Shared type definitions + env bindings
    utils/                     -- Logger, rate limiter, HTTP helpers, etc.
    config/                    -- Configuration constants
    constants/                 -- App-wide constants
```

## Workers

The package exports two Cloudflare Workers:

### Web Worker (`web.ts`)

The main admin-domain worker handling:

- **Authentication**: External login (Google, etc.), session management, CLI
  auth, account linking, OAuth2 authorization server
- **REST API**: Full CRUD under `/api` prefix (spaces, repos, deploys,
  domains, users, billing, etc.)
- **Git Smart HTTP**: Git clone/push/fetch over HTTP at `/git/` prefix
- **Static Assets**: SPA serving with `index.html` fallback
- **Security**: CORS, HTTPS enforcement, CSP headers, rate limiting
- **Scheduled Jobs**: Cron-triggered maintenance (domain reverification,
  dead session cleanup, snapshot GC, R2 orphan cleanup)
- **ActivityPub**: Federation endpoints and store
- **Profile Pages**: `/@username` routes

### Dispatch Worker (`dispatch.ts`)

Tenant-domain routing worker that:

- Resolves incoming hostname to a tenant worker via routing store
- Forwards requests with security headers (`X-Forwarded-Host`,
  `X-Takos-Internal`, `X-Tenant-Worker`)
- Supports multiple routing targets: Cloudflare Workers dispatch namespace,
  HTTP URL endpoints, and local service bindings
- Handles versioned deployments via `X-Tenant-Deployment`

## Durable Objects

Exported for wrangler.toml binding:

| Durable Object | Description |
|---|---|
| `SessionDO` | WebSocket session management |
| `RunNotifierDO` | Agent run status notifications |
| `NotificationNotifierDO` | Push notification delivery |
| `RateLimiterDO` | Distributed rate limiting |
| `RoutingDO` | Hostname routing cache |
| `GitPushLockDO` | Git push concurrency lock |

## Key Subpath Exports

The package provides granular subpath imports (50+ exports in `deno.json`):

| Import Specifier | Description |
|---|---|
| `takos-control/core` | Web worker entrypoint |
| `takos-control/core/web` | Web worker app + factory |
| `takos-control/core/dispatch` | Dispatch worker app + factory |
| `takos-control/core/platform` | Platform abstraction layer |
| `takos-control/agent` | AI agent service |
| `takos-control/agent/public-runner` | Public agent runner |
| `takos-control/git/smart` | Git Smart HTTP v2 protocol |
| `takos-control/git/smart/client` | Git Smart HTTP client |
| `takos-control/git/smart/operations` | Git operations helpers |
| `takos-control/git/source` | Source code management |
| `takos-control/platform` | Platform layer |
| `takos-control/platform/adapters/node` | Node.js platform adapter |
| `takos-control/platform/adapters/workers` | CF Workers platform adapter |
| `takos-control/platform/providers/cloudflare` | CF-specific providers |
| `takos-control/runtime/worker` | Worker runtime management |
| `takos-control/runtime/runner` | Job runner |
| `takos-control/runtime/durable-objects` | Durable Object exports |
| `takos-control/runtime/queues` | Queue processing |
| `takos-control/runtime/container-hosts` | Container host management |
| `takos-control/server/routes` | Route definitions |
| `takos-control/server/middleware` | Auth and asset middleware |
| `takos-control/shared/types` | Shared type definitions |
| `takos-control/shared/utils` | Shared utilities |
| `takos-control/shared/config` | Configuration |
| `takos-control/shared/constants` | Constants |

## Platform Abstraction

The `ControlPlatform<Env>` type abstracts infrastructure differences between
Cloudflare Workers and Node.js runtimes. Platform builders
(`buildWorkersWebPlatform`, `buildWorkersDispatchPlatform`) inject
environment-specific service implementations at startup.

```typescript
import { createWebWorker } from 'takos-control/core/web';
import { buildWorkersWebPlatform } from 'takos-control/platform/adapters/workers';

// Default CF Workers platform
export default createWebWorker();

// Custom platform
export default createWebWorker(myPlatformBuilder);
```

## Dependencies

Major dependencies:

- `hono` -- HTTP framework
- `jose` -- JWT signing/verification
- `zod` -- Schema validation
- `drizzle-orm` / `pg` / `@libsql/client` -- Database access
- `@langchain/core` / `@langchain/langgraph` / `@langchain/openai` -- AI agent
- `@modelcontextprotocol/sdk` -- MCP integration
- `@aws-sdk/client-s3` / `@aws-sdk/client-dynamodb` / `@aws-sdk/client-sqs` -- AWS services
- `@google-cloud/firestore` / `@google-cloud/pubsub` / `@google-cloud/storage` -- GCP services
- `@cloudflare/workers-types` -- CF Workers type definitions
- `redis` -- Redis client
- `yaml` -- YAML parsing
- `fflate` -- Compression
- `nanoid` -- ID generation
- `miniflare` -- Local CF Workers emulation

## Commands

```bash
cd takos && deno test --allow-all packages/control/src/
cd takos && deno test --allow-all --coverage packages/control/src/
```
