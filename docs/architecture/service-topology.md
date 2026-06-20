# サービストポロジー

> このページでわかること: Takos の runtime 境界と、local Compose が起動する開発用 process の違い。

Takos の product 境界は **単一の Takos distribution worker** です。self-host / hosted distribution では Takos product
surface、Takosumi Accounts、Takosumi deploy-control、dashboard、OpenTofu runner が同一 origin に compose されます。
`takos-git` と `takos-agent` は別 product ではなく、Takos product 内で使う container capability です。

local Compose は実装と smoke を扱いやすくするため、Takosumi control-plane source を `takosumi` dev sidecar process として
起動します。これは product の split-service 境界ではありません。

## Local Compose Services

| service        | default port | owner                         | role                                                                 |
| -------------- | -----------: | ----------------------------- | -------------------------------------------------------------------- |
| `takos-worker` |       `8787` | `src/worker`                  | Takos product HTTP entrypoint and local integration host              |
| `takosumi`     |       `8788` | `../takosumi`                 | local dev sidecar for Takosumi control-plane checks and run ledger    |
| `takos-agent`  |       `8789` | `containers/agent`            | agent execution container                                            |
| `takos-git`    |       `8790` | `containers/git`              | Git Smart HTTP / repository storage container                        |
| `postgres`     |      `15432` | `compose.local.yml`           | local durable store for Takos / Takosumi / Git                       |
| `redis`        |      `16379` | `compose.local.yml`           | local queue / cache substrate                                        |

The service set is validated by `bun run doctor`, `bun run local:config`, and `bun run local:e2e`.

## Call Shape

- Browser and API traffic enter through `takos-worker`.
- `takos-worker` reaches `takos-git` and `takos-agent` through local internal URLs and signed local secrets.
- `takosumi` in Compose is a dev sidecar for the Takosumi control-plane source. Production/self-host composition uses
  in-process Takosumi Accounts and deploy-control seams rather than a standalone Takosumi service boundary.
- Git Smart HTTP is surfaced through the Takos product path; `takos-git` accepts only internal local traffic.
- `takos-agent` executes agent workload and calls the configured control-plane/runtime endpoints for local smoke.

The local env names `TAKOSUMI_INTERNAL_URL`, `TAKOS_GIT_INTERNAL_URL`, `TAKOS_AGENT_INTERNAL_URL`,
`TAKOS_INTERNAL_SERVICE_SECRET`, `TAKOS_INTERNAL_API_SECRET`, and `TAKOSUMI_INTERNAL_API_SECRET` are Compose/dev wiring.
Do not treat them as hosted product subdomains or as a reason to reintroduce split public workers.

## Ownership Rules

- Takos owns the product surface: chat, agent, memory, Workspace, app launcher, Git/agent container UX, and the first-party
  Takos Service Graph profile.
- Takosumi owns Space / Source / Connection / Installation / Dependency / Run / RunGroup / Deployment / OutputSnapshot /
  Activity, the provider resolver, policy, audit, Service Graph standard, and Accounts plane.
- Production and staging deploy config and secrets live outside this repo in the operator environment.
- Do not add standalone deploy/runtime services to the product model. Local sidecars must stay local dev conveniences.
