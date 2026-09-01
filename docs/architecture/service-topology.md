# サービストポロジー

> このページでわかること: Takos の runtime 境界と、local Compose が起動する開発用 process の違い。

Takos の product 境界は **単一の Takos distribution worker** です。self-host / hosted distribution では Takos product
surface をこの worker が提供し、Takosumi Accounts、Takosumi deploy-control、dashboard、OpenTofu runner は外部 Takosumi
control plane が提供します。
`takos-agent` は別 product ではなく、Takos product 内で使う container capability です。Takos Worker
内蔵の migration-only Git Smart HTTP は fail-closed で quarantine されています。`takos-worker` は明示的な
migration まで既存 repository metadata / R2 objects を保持しますが、ref/object の広告・配信は行いません。
clone / fetch / push と collaborative hosting は installed `takos-git` が所有します。

local Compose は実装と smoke を扱いやすくするため、Takosumi control-plane source を `takosumi` dev sidecar process として
起動します。これは product の split-service 境界ではありません。

## Local Compose Services

| service        | default port | owner               | role                                                               |
| -------------- | -----------: | ------------------- | ------------------------------------------------------------------ |
| `takos-worker` |       `8787` | `src/worker`        | Takos product HTTP entrypoint and local integration host           |
| `takosumi`     |       `8788` | `../takosumi`       | local dev sidecar for Takosumi control-plane checks and run ledger |
| `takos-agent`  |       `8789` | `containers/agent`  | agent execution container                                          |
| `postgres`     |      `15432` | `compose.local.yml` | local durable store for Takos / Takosumi                           |
| `redis`        |      `16379` | `compose.local.yml` | local queue / cache substrate                                      |

The service set is validated by `bun run doctor`, `bun run local:config`, and `bun run local:e2e`. `local:e2e` additionally
layers a proof-only Compose override over this service set. Its local issuer, deterministic model endpoint, and executor bridge are
test harnesses, not product services.

## Call Shape

- Browser and API traffic enter through `takos-worker`.
- The normal execution path is public Takos API -> `RUN_QUEUE` -> executor/container dispatch -> `takos-agent` -> token-scoped
  control RPC -> durable Run status, output, event, and assistant message. `bun run local:e2e` proves this path to a terminal Run instead of
  treating health or gateway reachability as agent evidence.
- `takosumi` in Compose is a dev sidecar for the Takosumi control-plane source. Production/self-host composition uses
  an external Takosumi control-plane origin/API operated by the self-hoster or operator. The Takos Worker does not mount
  Accounts, deploy-control, dashboard, or OpenTofu runner handlers in-process.
- The built-in migration-only Git Smart HTTP route is quarantined fail-closed. `takos-worker` preserves existing repository metadata and R2 objects pending an explicit migration, but does not advertise refs or serve clone/fetch/push. Installed `takos-git` owns Git transport and collaborative hosting.
- `takos-agent` executes agent workload and calls the configured control-plane/runtime endpoints for local smoke.

The local env names `TAKOSUMI_INTERNAL_URL`, `TAKOS_AGENT_INTERNAL_URL`,
`TAKOS_INTERNAL_SERVICE_SECRET`, `TAKOS_INTERNAL_API_SECRET`, and `TAKOSUMI_INTERNAL_API_SECRET` are Compose/dev wiring.
Do not treat them as hosted product subdomains or as a reason to reintroduce split public workers.

## Ownership Rules

- Takos owns the product surface: chat, agent, memory, Workspace, app launcher, agent-container UX, the first-party
  Takos Capsule output projection profile, and the quarantine/preservation boundary for legacy built-in Git data. Installed `takos-git`
  owns clone, fetch, push, and collaborative hosting.
- Takosumi owns its OpenTofu control-plane Workspace, Project, Capsule, Source, ProviderConnection, ProviderBinding,
  OpenTofu Run, StateVersion, Output, policy, audit, provider resolver, Capsule output projection standard, and Accounts
  plane. Takos conversation Thread / agent Run remain Takos product state; the two Run ledgers are not interchangeable.
- Production and staging deploy config and secrets live outside this repo in the operator environment.
- Do not add standalone deploy/runtime services to the product model. Local sidecars must stay local dev conveniences.
