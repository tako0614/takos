# takos-runtime-service

Runtime execution service for the Takos platform. Provides an HTTP API for
sandboxed code execution, tool invocation, session management, repository
operations, Git initialization, GitHub Actions job orchestration, and CLI proxy
forwarding. Runs as a standalone Deno server, authenticated via
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
    space-scope.ts        -- space scope enforcement
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

| Method | Path       | Auth | Description    |
| ------ | ---------- | ---- | -------------- |
| `GET`  | `/ping`    | Yes  | Returns `pong` |
| `GET`  | `/health`  | No   | Health check   |
| `GET`  | `/healthz` | No   | Health check   |

### Code Execution (`/exec`)

Rate limit: 60 req/min

Sandboxed command execution with allowlisted commands and blocklist patterns.
Supports file staging, output collection, and concurrent execution limits.

### Tool Invocation (`/execute-tool`)

Named tool registration and invocation with configurable timeouts (max 60s).

### Sessions (`/session`, `/sessions`)

Rate limit: 30 req/min for session routes, 60 req/min for execution routes, 10
req/min for snapshots. `/session/exec` receives both the session and exec
limiters, so the effective cap is 30 req/min.

Full session lifecycle:

- Create/destroy sessions with space scoping
- Execute commands within a session context
- Read/write files in the session workdir
- Save/restore session snapshots via R2/S3 storage
- Heartbeat-based liveness tracking with automatic cleanup

### Repositories (`/repos`)

Rate limit: 60 req/min

Repository management operations with space scope enforcement. Supports read and
write operations through dedicated route groups.

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
2. Conditional loopback bypass for local CLI connections. It is only enabled
   when `TAKOS_RUNTIME_ALLOW_LOOPBACK_CLI_PROXY_BYPASS=1` is set, or when the
   service is started with a local data dir or `allowLocalCliProxyBypass`
   option. In that mode it still requires `X-Takos-Session-Id` and a loopback
   source IP.

## Security

### Authentication

All endpoints except `/health` and `/healthz` require a valid RS256 JWT service
token in the `Authorization: Bearer <token>` header. Tokens are issued by
`takos-control` with:

- Issuer: `takos-control`
- Audience: `takos-runtime`
- Clock tolerance: 30 seconds

### Sandbox Policy

Command execution is restricted to an allowlist of safe commands:

- **Base commands**: `npm`, `npx`, `node`, `git`, `ls`, `cat`, `grep`, `curl`,
  `tsc`, `jest`, etc.
- **Extended profile** (opt-in via `COMMAND_PROFILE=extended`): adds `kill`,
  `killall`, `pkill`, `printenv`
- **Blocklist patterns**: destructive operations (`rm -rf /`, `reboot`,
  `dd of=/dev/`), fork bombs, cloud metadata SSRF attempts

### Rate Limiting

Sliding-window rate limiting per endpoint group:

| Endpoint Group                                       | Max Requests/min |
| ---------------------------------------------------- | ---------------- |
| `/exec`, `/exec/*`, `/execute-tool`, `/session/exec` | 60               |
| `/session/*`                                         | 30               |
| `/session/snapshot`, `/session/snapshot/*`           | 10               |
| `/actions/*`                                         | 30               |
| `/git/*`                                             | 30               |
| `/repos/*`                                           | 60               |
| `/cli-proxy/*`                                       | 60               |

`/session/exec` matches both `/session/*` and `/session/exec`; both limiters are
applied.

Rate-limit keys are built from the request IP. When `X-Takos-Space-Id` is
present, the key is `${ip}:${spaceId}`; otherwise it is just `ip`.

### Space Scope

Session and repository routes enforce space scope isolation via middleware.
Space IDs are extracted from request bodies or URL paths and validated against
the service token claims.

## Configuration

| Env Variable           | Required | Default                 | Description                             |
| ---------------------- | -------- | ----------------------- | --------------------------------------- |
| `PORT`                 | No       | `8080`                  | HTTP server port                        |
| `TAKOS_API_URL`        | Yes      | --                      | Control plane API URL                   |
| `JWT_PUBLIC_KEY`       | Yes*     | --                      | RS256 public key for token verification |
| `GIT_ENDPOINT_URL`     | No       | `https://git.takos.dev` | Git endpoint base URL                   |
| `PROXY_BASE_URL`       | No       | --                      | CLI proxy base URL                      |
| `R2_ACCOUNT_ID`        | No       | --                      | Cloudflare R2 account                   |
| `R2_ACCESS_KEY_ID`     | No       | --                      | R2 access key                           |
| `R2_SECRET_ACCESS_KEY` | No       | --                      | R2 secret key                           |
| `R2_BUCKET`            | No       | `takos-tenant-source`   | R2/S3 bucket name                       |
| `S3_ENDPOINT`          | No       | auto                    | S3-compatible endpoint                  |
| `S3_REGION`            | No       | auto                    | S3 region                               |
| `S3_ACCESS_KEY_ID`     | No       | `R2_ACCESS_KEY_ID`      | S3-compatible access key                |
| `S3_SECRET_ACCESS_KEY` | No       | `R2_SECRET_ACCESS_KEY`  | S3-compatible secret key                |
| `S3_BUCKET`            | No       | `R2_BUCKET`             | S3-compatible bucket name               |
| `NODE_ENV`             | No       | --                      | `production` enables HTTPS enforcement  |
| `CF_CONTAINER`         | No       | --                      | Set when running in CF container        |
| `COMMAND_PROFILE`      | No       | --                      | `extended` for additional commands      |

`S3_*` values are read first. `R2_*` names are compatibility fallbacks.

### Execution Limits

| Limit                            | Value                        |
| -------------------------------- | ---------------------------- |
| `/exec` timeout                  | default 300s, max 1800s      |
| `/exec` staged input size        | 10 MB per file, 100 MB total |
| `/exec` requested output size    | 5 MB per file, 20 MB total   |
| `/execute-tool` timeout          | default 30s, max 60s         |
| Actions step execution time      | 1 hour                       |
| Actions output buffer            | 100 MB                       |
| Actions concurrent jobs          | 10                           |
| Actions max job duration         | 6 hours                      |
| Actions max steps per job        | 1,000                        |
| Max concurrent `/exec` per space | 5                            |
| Max sessions per space           | 2                            |
| Session idle timeout             | 10 minutes                   |
| Session max duration             | 1 hour                       |

## Key Exports

| Export                              | Description                            |
| ----------------------------------- | -------------------------------------- |
| `createRuntimeServiceApp(options?)` | Create Hono app without server binding |
| `startRuntimeService(options?)`     | Create app and start Deno HTTP server  |

### Types

| Type                    | Description                                                                     |
| ----------------------- | ------------------------------------------------------------------------------- |
| `RuntimeServiceOptions` | Service config: `port`, `serviceName`, `isProduction`, `isContainerEnvironment` |
| `RuntimeEnv`            | Hono environment type with `requestId`, `log`, `serviceToken`, `parsedBody`     |

## Dependencies

- `hono` -- HTTP framework
- `yaml` -- YAML parsing
- `@aws-sdk/client-s3` -- S3/R2 storage
- `takos-common` -- Logger, errors, middleware, validation, env parsing

## Commands

```bash
cd takos && deno test --allow-all packages/runtime-service/src/
```
