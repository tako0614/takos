# Takos

Takos core monorepo.

The package trees under `packages/` are the source of truth. `apps/*` are thin
composition layers, deployment entrypoints, and app-local wrappers around those
packages.

## What Is In This Repo

- `packages/control/*`: control-plane, host, and local-platform package trees
- `packages/runtime-service`, `packages/executor-service`, `packages/browser-service`: service packages used by app wrappers and sibling repos
- `packages/common`, `packages/actions-engine`, `packages/agent-core`, `packages/cloudflare-compat`: shared libraries
- `apps/control`: Cloudflare worker composition, frontend build, and deployment templates
- `apps/runtime`, `apps/executor`, `apps/browser`: thin Node/container wrappers over the service packages
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

Additional architecture and product docs may live in an external docs
repository, but this repo should remain understandable on its own. Public
setup, build, and contribution flow must stay documented here.

`takos-private/` can consume this repo as a sibling checkout and should only use
package exports, not `apps/*` source paths. The `home-agent` runner is
private-only and does not belong in OSS product flow.

## Deployment Configuration

Tracked `wrangler*.toml`, `.env.example`, and secrets docs in this repository
are OSS-safe templates. Replace placeholder domains, IDs, and resource names
with your own before deploying.

## Contributing

See `CONTRIBUTING.md` for contributor expectations and `SECURITY.md` for
security reporting guidance.
