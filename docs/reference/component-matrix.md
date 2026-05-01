# Component Matrix

`takos` pins the component checkouts that make up the local Takos product shell.

| Path     | Remote                                        | Kind         | Owner Responsibility                                                  | Representative Check         |
| -------- | --------------------------------------------- | ------------ | --------------------------------------------------------------------- | ---------------------------- |
| `app/`   | `https://github.com/tako0614/takos-app.git`   | service repo | app/API gateway, account/auth/profile/billing, public API             | `cd app && deno task check`  |
| `paas/`  | `https://github.com/tako0614/takos-paas.git`  | service repo | PaaS control plane, deploy/runtime lifecycle, tenant/platform domains, canonical agent-control RPC | `cd paas && deno task check` |
| `git/`   | `https://github.com/tako0614/takos-git.git`   | service repo | Git hosting, refs, objects, Smart HTTP, source resolution             | `cd git && deno task check`  |
| `agent/` | `https://github.com/tako0614/takos-agent.git` | service repo | agent execution service and PaaS-owned agent-control RPC client       | `cd agent && cargo test`     |

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
