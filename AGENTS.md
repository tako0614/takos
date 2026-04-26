# AGENTS.md

This repository is the Takos product shell.

- Treat `paas/` as the repo root for Takos PaaS/control-plane work.
- Treat `git/` as the repo root for Takos Git hosting work.
- Treat `web/` as the repo root for user-facing web/API gateway work.
- Treat `agent/` as the repo root for agent execution service work.
- Do not add product implementation code or workspace configuration to this
  shell repo.
- `takos-agent-engine/` is owned by the ecosystem root checkout and must stay
  outside all service repos.
- Deploy configuration and secrets are owned by `../takos-private`; do not
  perform production or staging deploys from this shell.

Layer rules:

- `web/` may depend on `paas/packages/paas-contract` and
  `git/packages/git-contract` only, not on implementation packages.
- `git/` must not import `web/` or `paas/` implementation.
- `paas/` must not import `web/` implementation.
- `agent/` may depend on `../takos-agent-engine` as an external path/package.
