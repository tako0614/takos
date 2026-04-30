# AGENTS.md

This repository is the Takos product shell.

- Treat `paas/` as the repo root for Takos PaaS/control-plane work.
- Treat `docs/contributing/` as shell-owned Takos planning docs (formerly `plan/`). Product roots may reference it, but
  must not move product implementation code into it.
- Treat `app/` as the repo root for user-facing Takos app/API gateway work.
- Treat `git/` as the repo root for Takos Git hosting work.
- Treat `paas/` as the repo root for canonical Takos deploy and runtime lifecycle work.
- Treat `agent/` as the repo root for agent execution service work.
- Do not add product implementation code or workspace configuration to this shell repo.
- Do not reintroduce standalone deploy or runtime services in shell compose/env files; those lifecycles are owned by
  `paas/`.
- `takos-agent-engine/` is a Rust library, not a Takos service. It is owned by the ecosystem root checkout and must stay
  outside all service repos.
- Do not add generic `common` packages. Shared behavior must be service-local unless it is a named domain library with a
  clear owner.
- Deploy configuration and secrets are owned by `../takos-private`; do not perform production or staging deploys from
  this shell, and do not add private deploy entrypoints that import OSS source paths directly.

Layer rules:

- `app/` may depend on service contracts only, not on implementation packages.
- `git/` and `paas/` must not import `app/` implementation.
- `paas/` must not import `git/` implementation.
- `agent/` may depend on `../takos-agent-engine` as an external path/package.
- Provider plugins must depend on PaaS plugin contracts/SDK, not `paas/apps/paas/src` implementation paths.
