# takos-runtime-service

Runtime execution service for the Takos platform. Provides an HTTP API for
sandboxed code execution, tool invocation, session management, repository
operations, Git initialization, GitHub Actions job orchestration, and CLI
proxy forwarding. Runs as a standalone Deno server, authenticated via
service-to-service RS256 JWT tokens issued by `takos-control`.

## Architecture

```
src/
  index.ts                -- re-exports from app.ts
  app.ts                  -- Hono app factory + standalone server entrypoint
  types/
    hono.d.ts             -- RuntimeEnv type (Hono context variables)
  shared/
    config.ts             -- env vars, limits, security policy, rate limits
  middleware/
    rate-limit.ts         -- sliding-window rate limiter
    space-scope.ts        -- workspace scope enforcement
  routes/
    runtime/
      exec.ts             -- code execution endpoints
      tools.ts            -- tool invocation endpoints
    sessions/
      execution.ts        -- session-scoped execution
      files.ts            -- session file I/O
      snapshot.ts         -- session snapshot (save/restore)
      session-routes.ts   -- session lifecycle management
    repos/
      read.ts             -- repository read operations
      write.ts            -- repository write operations
    git/
      init.ts             -- Git repository initialization
      http.ts             -- Git HTTP transport endpoints
    actions/
      index.ts            -- GitHub Actions job orchestration
    cli/
      proxy.ts            -- CLI proxy forwarding
  runtime/
    actions/
      job-manager.ts      -- Actions job lifecycle management
  storage/
    r2.ts                 -- R2/S3 storage integration
  utils/                  -- Shared utilities
```

## API Endpoints

### Health

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/ping` | No | Returns `pong` |
| `GET` | `/health` | No | Health check |

### Code Execution (`/exec`)

Rate limit: 60 req/min

Sandboxed command execution with allowlisted commands and blocklist patterns.
Supports file staging, output collection, and concurrent execution limits.

### Tool Invocation (`/execute-tool`)

Named tool registration and invocation with configurable timeouts (max 60s).

### Sessions (`/session`, `/sessions`)

Rate limit: 30 req/min (execution), 10 req/min (snapshots)

Full session lifecycle:

- Create/destroy sessions with workspace scoping
- Execute commands within a session context
- Read/write files in session workspace
- Save/restore session snapshots via R2/S3 storage
- Heartbeat-based liveness tracking with automatic cleanup

### Repositories (`/repos`)

Rate limit: 60 req/min

Repository management operations with workspace scope enforcement. Supports
read and write operations through dedicated route groups.

### Git (`/git`)

Rate limit: 30 req/min

- Repository initialization (`/git/init`)
- Git HTTP transport for clone/fetch/push operations

### GitHub Actions (`/actions`)

Rate limit: 30 req/min

Job orchestration for GitHub Actions-compatible workflow execution:

- Job lifecycle management via `jobManager`
- Automatic cleanup of stale jobs

### CLI Proxy (`/cli-proxy`)

Rate limit: 60 req/min

Forward requests from local CLI clients. Supports two authentication modes:

1. Standard JWT service token
2. Loopback bypass for local CLI connections (requires `X-Takos-Session-Id`
   header and loopback source IP)

## Security

### Authentication

All endpoints (except `/health` and `/ping`) require a valid RS256 JWT
service token in the `Authorization: Bearer <token>` header. Tokens are
issued by `takos-control` with:

- Issuer: `takos-control`
- Audience: `takos-runtime`
- Clock tolerance: 30 seconds

### Sandbox Policy

Command execution is restricted to an allowlist of safe commands:

- **Base commands**: `npm`, `npx`, `node`, `git`, `ls`, `cat`, `grep`,
  `curl`, `tsc`, `jest`, etc.
- **Extended profile** (opt-in via `COMMAND_PROFILE=extended`): adds `kill`,
  `killall`, `pkill`, `printenv`
- **Blocklist patterns**: destructive operations (`rm -rf /`, `reboot`,
  `dd of=/dev/`), fork bombs, cloud metadata SSRF attempts

### Rate Limiting

Sliding-window rate limiting per endpoint group:

| Endpoint Group | Max Requests/min |
|---|---|
| `/exec/*` | 60 |
| `/session/*` | 30 |
| `/session/snapshot/*` | 10 |
| `/actions/*` | 30 |
| `/git/*` | 30 |
| `/repos/*` | 60 |
| `/cli-proxy/*` | 60 |

### Workspace Scope

Session and repository routes enforce workspace scope isolation via
middleware. Space IDs are extracted from request bodies or URL paths and
validated against the service token claims.

## Configuration

| Env Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `8080` | HTTP server port |
| `TAKOS_API_URL` | Yes | -- | Control plane API URL |
| `JWT_PUBLIC_KEY` | Yes* | -- | RS256 public key for token verification |
| `GIT_ENDPOINT_URL` | No | `https://git.takos.dev` | Git endpoint base URL |
| `PROXY_BASE_URL` | No | -- | CLI proxy base URL |
| `R2_ACCOUNT_ID` | No | -- | Cloudflare R2 account |
| `R2_ACCESS_KEY_ID` | No | -- | R2 access key |
| `R2_SECRET_ACCESS_KEY` | No | -- | R2 secret key |
| `R2_BUCKET` | No | `takos-tenant-source` | R2/S3 bucket name |
| `S3_ENDPOINT` | No | auto | S3-compatible endpoint |
| `S3_REGION` | No | auto | S3 region |
| `NODE_ENV` | No | -- | `production` enables HTTPS enforcement |
| `CF_CONTAINER` | No | -- | Set when running in CF container |
| `COMMAND_PROFILE` | No | -- | `extended` for additional commands |

### Execution Limits

| Limit | Value |
|---|---|
| Max execution time | 1 hour |
| Max output size | 100 MB |
| Max concurrent jobs | 10 |
| Max job duration | 6 hours |
| Max steps per job | 1,000 |
| Max concurrent exec per workspace | 5 |
| Max sessions per workspace | 2 |
| Session idle timeout | 10 minutes |
| Session max duration | 1 hour |

## Key Exports

| Export | Description |
|---|---|
| `createRuntimeServiceApp(options?)` | Create Hono app without server binding |
| `startRuntimeService(options?)` | Create app and start Deno HTTP server |

### Types

| Type | Description |
|---|---|
| `RuntimeServiceOptions` | Service config: `port`, `serviceName`, `isProduction`, `isContainerEnvironment` |
| `RuntimeEnv` | Hono environment type with `requestId`, `log`, `serviceToken`, `parsedBody` |

## Dependencies

- `hono` -- HTTP framework
- `yaml` -- YAML parsing
- `@aws-sdk/client-s3` -- S3/R2 storage
- `takos-common` -- Logger, errors, middleware, validation, env parsing

## Commands

```bash
cd takos && deno test --allow-all packages/runtime-service/src/
```
