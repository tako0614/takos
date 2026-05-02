# takos

Takos product shell and local entrypoint.

This repository is intentionally a shell: product implementation lives in nested service repositories, while this repo
owns the local service composition, boundary checks, component matrix, and product-level docs. It should feel like the
front door for Takos, not a place to put shared implementation packages.

```text
takos/
  agent/  -> takos-agent
  app/    -> takos-app
  git/    -> takos-git
  paas/   -> Takos deploy artifacts (helm/terraform/distributions). Kernel itself is external (jsr:@takos/takosumi-kernel)
  docs/   -> shell-owned product architecture, runbooks, and planning docs
```

`takos-agent-engine` is a Rust library, not a Takos service. It remains an independent checkout at the ecosystem root
and is not vendored into any service repo.

## Quick Start

```sh
git submodule update --init --recursive
deno task doctor
deno task local:config
deno task local:up
```

Useful shell tasks:

- `deno task doctor`: human-readable tool, submodule, compose, and boundary diagnostics.
- `deno task check`: strict lightweight shell check for automation.
- `deno task local:config`: render the local compose config without starting services.
- `deno task local:up` / `deno task local:down` / `deno task local:logs`: run the local shell.
- `deno task docs:dev` / `deno task docs:build`: work on the shell docs.
- `deno task submodules:update`: initialize or refresh nested service checkouts.

## Boundary Names

Product-level architecture and planning docs live under `docs/` at this shell level. Product roots may link to those
plans, but the docs tree is not owned by `paas/` and must not contain product implementation code.

Use the split repository boundaries below when adding docs, scripts, imports, or local composition. Do not reintroduce
pre-split path references such as `takos/apps` or `takos/packages`, path-level legacy references, or stale service names
such as `control-legacy`, `runtime-legacy`, or `takos-web`. Keep compatibility behavior and legacy data migrations
documented where they are still part of the contract, but avoid using legacy names as current source paths or service
identities.

## Responsibility Split

- `app`: accounts, auth, profiles, billing, OAuth, user settings, user-facing management UI, public/browser/CLI API
  gateway, and product API that is not owned by another Takos service.
- `paas`: tenant/platform management, tenant and space registry, routing/entitlement context, deploy and runtime
  lifecycle domains, resource/routing/publication domains, and internal tenant/control API.
- `git`: Git hosting, Git Smart HTTP, repositories/source, refs, object storage, source resolution, and repository API
  contracts.
- `agent`: agent execution service. It calls PaaS internal control RPC.

Deploy and runtime lifecycle semantics are canonical in `paas` domains/process roles. Service contracts should be
exported by the owning core service.

Browser and CLI clients talk to `takos-app`. `takos-app` verifies public sessions/tokens and calls internal services
with signed internal requests carrying actor context. Internal services do not verify browser cookies or public OAuth
tokens directly.

## Local Checkout

```sh
git submodule update --init --recursive
```

The planned remote repositories are:

- `https://github.com/tako0614/takos-paas.git`
- `https://github.com/tako0614/takos-git.git`
- `https://github.com/tako0614/takos-app.git`
- `https://github.com/tako0614/takos-agent.git`

## Local Compose

```sh
deno task local:up
```

The local compose entrypoint should expose the core service set: `takos-app`, `takos-git`, `takosumi`, and
`takos-agent`. Do not add standalone deploy or runtime services to this shell compose file; those lifecycles are local
process roles and domains of `takosumi`.

See also:

- [Service Topology](docs/architecture/service-topology.md)
- [Local Shell Runbook](docs/get-started/local-shell.md)
- [Component Matrix](docs/reference/component-matrix.md)
