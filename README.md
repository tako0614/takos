# Takos

Takos core monorepo.

The package trees under `packages/` are the source of truth. `apps/*` are thin
composition layers, deployment entrypoints, and app-local wrappers around those
packages.

## What Is In This Repo

- `packages/control/*`: control-plane, host, and local-platform package trees
- `packages/runtime-service`, `packages/executor-service`, `packages/browser-service`: service packages (executor-service and browser-service are self-contained deployable services; runtime-service is used by the apps/runtime wrapper)
- `packages/common`, `packages/actions-engine`, `packages/agent-core`, `packages/cloudflare-compat`: shared libraries
- `apps/control`: Cloudflare worker composition, frontend build, and deployment templates
- `apps/runtime`: thin Node/container wrapper over runtime-service
- `apps/cli`: public CLI
- `scripts/`: build, validation, and maintenance tooling

## Requirements

- Node.js 20+
- pnpm 9+

## Quickstart

```bash
pnpm install
pnpm build:all
pnpm test:all
```

Docs preview:

```bash
pnpm docs:dev
```

For local control-plane development:

```bash
pnpm dev:takos
```

For the local stack:

```bash
cp .env.local.example .env.local
pnpm local:up
# or:
# TAKOS_LOCAL_ENV_FILE=/path/to/local.env pnpm local:up
```

## Documentation

Takos docs live in-repo under `apps/docs-site/docs` and are rendered with
VitePress. Keep `README.md` as the short entrypoint and put longer setup,
runtime, deployment, and contributor guidance in the docs site.

`takos-private/` can consume this repo as a sibling checkout and should only use
package exports, not `apps/*` source paths. The `home-agent` runner is
private-only and does not belong in OSS product flow.

## Deployment Configuration

Tracked `wrangler*.toml`, `.env.example`, and secrets docs in this repository
are OSS-safe templates. Replace placeholder domains, IDs, and resource names
with your own before deploying.

## Contributing

See `CONTRIBUTING.md`, `apps/docs-site/docs`, and `SECURITY.md` for
contributor expectations, product/spec docs, and security reporting guidance.
