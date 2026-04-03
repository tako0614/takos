# apps/runtime

Standalone runtime service application that executes sandboxed code for the Takos AI agent. It can run either inside Cloudflare Containers or as a standalone Deno server.

The application is a thin entry point that imports and starts `takos-runtime-service` (from `packages/runtime-service/`). In development it loads TypeScript directly; in production it loads the pre-compiled JS build.

## Getting started

```sh
# Copy environment template
cp .env.example .env

# Start in development mode (with file watching)
cd takos && deno task -c apps/runtime/deno.json dev

# Start in production mode
cd takos && deno task -c apps/runtime/deno.json start
```

## Available tasks

| Task | Command | Description |
|---|---|---|
| `start` | `deno run --allow-all src/index.ts` | Start the service |
| `dev` | `deno run --allow-all --watch src/index.ts` | Start with file watching |
| `test` | `deno test --allow-all src/` | Run tests |
| `test:coverage` | `deno test --allow-all --coverage src/` | Run tests with coverage |

## Environment variables

Copy `.env.example` for a complete reference. Key variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Server listen port |
| `NODE_ENV` | `development` | Environment mode |
| `S3_ENDPOINT` | - | S3-compatible object storage endpoint |
| `S3_ACCESS_KEY_ID` | - | Storage access key |
| `S3_SECRET_ACCESS_KEY` | - | Storage secret key |
| `S3_BUCKET` | - | Storage bucket name |
| `TAKOS_API_URL` | - | URL of the takos-control service |
| `JWT_PUBLIC_KEY` | - | RS256 public key for service-to-service JWT verification |
| `GIT_ENDPOINT_URL` | - | Git remote endpoint for repository operations |

Cloudflare R2 compatibility aliases (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, etc.) are also supported as fallbacks.

## Docker deployment

The runtime ships with a multi-stage `Dockerfile` based on `denoland/deno:alpine-2`. The image includes git, curl, wget, and unzip for user action execution, and installs the `takos` CLI globally.

```sh
# Build from the takos monorepo root
cd takos && docker build -f apps/runtime/Dockerfile -t takos-runtime .

# Run
docker run -p 8080:8080 --env-file apps/runtime/.env takos-runtime
```

Inside Cloudflare Containers the `TAKOS_API_URL` is injected at runtime by the container host. The `CF_CONTAINER=true` flag is set to bypass HTTPS enforcement for internal traffic.
