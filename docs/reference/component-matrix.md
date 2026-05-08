# Component Matrix

`takos` pins the component checkouts that make up the local Takos product shell.

Installable App Model では Takos 自身が Git URL から Takosumi Account に install
される app となり、OAuth provider / billing owner / app installation owner は
Takos ではなく **Takosumi Accounts** (= takosumi-cloud account plane) に集約され
ます。下表の Owner Responsibility はこの境界に沿って書かれています。詳細は
[Installable App Model](/architecture/installable-app-model) と
[System Architecture §2](/architecture/system-architecture) を参照。

| Path                                 | Remote                                         | Kind         | Owner Responsibility                                                                                                                                                                             | Representative Check                                        |
| ------------------------------------ | ---------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `app/`                               | `https://github.com/tako0614/takos-app.git`    | service repo | OIDC consumer / app-local profile / public API gateway / chat / agent / memory (OAuth provider / Stripe billing は **持たない** — Takosumi Accounts 側)                                          | `cd app && deno task check`                                 |
| `../takosumi/`                       | `https://github.com/tako0614/takosumi.git`     | sibling repo | Takosumi kernel = compute substrate / manifest deploy engine。`POST /v1/deployments` のみ。OAuth / billing / account / workflow / cron は持たない                                                | `cd ../takosumi && deno task check`                         |
| `../takosumi-git/`                   | `https://github.com/tako0614/takosumi-git.git` | sibling repo | 上位 sibling product。Git URL installer / `.takosumi/app.yml` parser / workflow runner / manifest compiler / kernel deploy bridge                                                                | `cd ../takosumi-git && deno task check`                     |
| `../takosumi-cloud/` (Phase 1.1 NEW) | (未公開)                                       | sibling repo | Takosumi Accounts (OIDC issuer / identity broker) / AppInstallation 台帳 / billing owner / dashboard / Git URL install UI。Phase 1.1 scaffold として accounts contract / service / CLI が存在    | `cd ../takosumi-cloud && deno task check && deno task test` |
| `git/`                               | `https://github.com/tako0614/takos-git.git`    | service repo | Takos Git hosting service。repository object storage / refs / Smart HTTP / source resolution。`takosumi-git` (workflow / git bridge) とは別物                                                    | `cd git && deno task check`                                 |
| `agent/`                             | `https://github.com/tako0614/takos-agent.git`  | service repo | agent execution service and PaaS-owned agent-control RPC client                                                                                                                                  | `cd agent && cargo test`                                    |
| `../takos-cli/`                      | `https://github.com/tako0614/takos-cli.git`    | sibling repo | user / operator CLI。Installable App Model の install / materialize / export は Takosumi Accounts API + `takosumi-git` installer pipeline が扱い、`takosumi` CLI は explicit manifest apply のみ | `cd ../takos-cli && deno task check`                        |
| `../takos-private/`                  | (private)                                      | sibling repo | Takos の private operator config / secrets / production / staging deploy。Takos の deploy 作業の正本 (OSS source path を import せず、published package / image / API / manifest で接続)         | (private)                                                   |

## Shell-Owned Surface

| File                 | Purpose                                 |
| -------------------- | --------------------------------------- |
| `compose.local.yml`  | local multi-service composition only    |
| `deno.json`          | shell task entrypoints                  |
| `scripts/doctor.mjs` | lightweight shell integrity checks      |
| `docs/`              | product-level architecture and runbooks |

## Non-Goals

- No standalone deploy service in this shell.
- No standalone runtime service in this shell.
- No product implementation workspace at the shell root.
- No generic `common` package without a named owner and contract.
