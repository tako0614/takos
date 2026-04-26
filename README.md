# takos

Takos product shell.

Implementation is split into nested Takos repositories:

```text
takos/
  agent/  -> takos-agent
  git/    -> takos-git
  paas/   -> takos-paas
  web/    -> current checkout for takos-app
```

`takos-agent-engine` is a Rust library, not a Takos service. It remains an independent checkout at the ecosystem root
and is not vendored into any service repo.

## Responsibility Split

- `app`: accounts, auth, profiles, billing, OAuth, user settings, user-facing management UI, public/browser/CLI API
  gateway, and product API that is not owned by another Takos service. Current checkout path: `web/`.
- `paas`: tenant/platform management, tenant and space registry, routing/entitlement context, and internal tenant API.
- `git`: Git hosting, Git Smart HTTP, repositories/source, refs, object storage, source resolution, and repository API
  contracts.
- `deploy`: planned extraction target for deploy planning/apply/rollback, manifests, and release history.
- `runtime`: planned extraction target for workers/services/resources, runtime routing, and worker/container lifecycle.
- `agent`: agent execution service. It calls PaaS internal control RPC.

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
- `https://github.com/tako0614/takos-web.git`
- `https://github.com/tako0614/takos-agent.git`

## Local Compose

```sh
docker compose --env-file ${TAKOS_LOCAL_ENV_FILE:-.env.local} -f compose.local.yml up --build
```

The local compose entrypoint exposes separate `takos-web`, `takos-git`, `takos-paas`, and `takos-agent` services. Web,
Git, and PaaS use separate database URLs; local development may point them at separate databases in the same Postgres
container.
