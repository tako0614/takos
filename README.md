# takos

Takos product shell.

Implementation is split into nested repositories:

```text
takos/
  agent/  -> takos-agent
  git/    -> takos-git
  paas/   -> takos-paas
  web/    -> takos-web
```

`takos-agent-engine` remains an independent library checkout at the ecosystem
root and is not vendored into any service repo.

## Responsibility Split

- `web`: accounts, auth, profiles, billing, OAuth, user settings,
  user-facing management UI, public/browser/CLI API gateway, and all
  non-tenant/non-Git product API.
- `git`: Git hosting, Git Smart HTTP, repositories/source, refs, object
  storage, source resolution, and repository API contracts.
- `paas`: tenant/platform management only: tenant routing, deploy/runtime
  tenancy, worker/container tenancy, resource tenancy, and internal tenant API.
- `agent`: agent execution service. It calls PaaS internal control RPC.

Browser and CLI clients talk to `takos-web`. `takos-web` verifies public
sessions/tokens and calls `takos-git` or `takos-paas` with signed internal
requests carrying actor context. Internal services do not verify browser
cookies or public OAuth tokens directly.

## Local Checkout

```sh
git submodule update --init --recursive
```

The planned remote repositories are:

- `https://github.com/tako0614/takos-paas.git`
- `https://github.com/tako0614/takos-git.git`
- `https://github.com/tako0614/takos-web.git`
- `https://github.com/tako0614/takos-agent.git`

## Local Compose

```sh
docker compose --env-file ${TAKOS_LOCAL_ENV_FILE:-.env.local} -f compose.local.yml up --build
```

The local compose entrypoint exposes separate `takos-web`, `takos-git`,
`takos-paas`, and `takos-agent` services. Web, Git, and PaaS use separate
database URLs; local development may point them at separate databases in the
same Postgres container.
