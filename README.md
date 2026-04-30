# takos

Takos product shell.

Implementation is split into nested Takos repositories. The target control plane shape is `takos-paas` as the PaaS
monolith with deploy and runtime lifecycle domains inside it.

```text
takos/
  agent/  -> takos-agent
  app/    -> takos-app
  git/    -> takos-git
  paas/   -> takos-paas, including deploy and runtime lifecycle ownership
  docs/contributing/ -> shell-owned Takos planning docs
```

`takos-agent-engine` is a Rust library, not a Takos service. It remains an independent checkout at the ecosystem root
and is not vendored into any service repo.

## Boundary Names

Planning docs live under `docs/contributing/` at this shell level. Product roots may link to those plans, but the
planning tree is not owned by `paas/` and should not contain product implementation code.

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
docker compose --env-file ${TAKOS_LOCAL_ENV_FILE:-.env.local} -f compose.local.yml up --build
```

The local compose entrypoint should expose the core service set: `takos-app`, `takos-git`, `takos-paas`, and
`takos-agent`. Do not add standalone deploy or runtime services to this shell compose file; those lifecycles are local
process roles and domains of `takos-paas`.
