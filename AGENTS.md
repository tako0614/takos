# AGENTS.md

This repository is the Takos product shell.

- Treat `paas/` as the repo root for Takos PaaS/control-plane work.
- Treat `app/` as the repo root for user-facing Takos app/API gateway work.
- Treat `git/` as the repo root for Takos Git hosting work.
- Treat `deploy/` as the repo root for Takos deploy lifecycle work.
- Treat `runtime/` as the repo root for Takos runtime lifecycle work.
- Treat `agent/` as the repo root for agent execution service work.
- Do not add product implementation code or workspace configuration to this shell repo.
- `takos-agent-engine/` is a Rust library, not a Takos service. It is owned by the ecosystem root checkout and must stay
  outside all service repos.
- Deploy configuration and secrets are owned by `../takos-private`; do not perform production or staging deploys from
  this shell.

Layer rules:

- `app/` may depend on service contracts only, not on implementation packages.
- `git/`, `deploy/`, `runtime/`, and `paas/` must not import `app/` implementation.
- `paas/` must not import `git/`, `deploy/`, or `runtime/` implementation.
- `agent/` may depend on `../takos-agent-engine` as an external path/package.
