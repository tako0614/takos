# AGENTS.md

This repository is the Takos product shell.

- Treat `../takosumi/` as the repo root for Takosumi kernel/control-plane work.
- Treat `docs/contributing/` as shell-owned Takos planning docs (formerly `plan/`). Product roots may reference it, but
  must not move product implementation code into it.
- Treat `app/` as the repo root for user-facing Takos app/API gateway work.
- Treat `git/` as the repo root for Takos Git hosting work.
- Treat `deploy/` as the shell-owned Takos product distribution root for Helm, Terraform, distribution manifests, and
  validator scripts that wrap published packages/images/APIs.
- Treat `agent/` as the repo root for agent execution service work.
- Do not add product implementation code or workspace configuration to this shell repo.
- Do not reintroduce standalone deploy or runtime services in shell compose/env files; those lifecycles are owned by
  `../takosumi/`.
- `takos-agent-engine/` is a Rust library, not a Takos service. It is owned by the ecosystem root checkout and must stay
  outside all service repos.
- Do not add generic `common` packages. Shared behavior must be service-local unless it is a named domain library with a
  clear owner.
- Deploy configuration and secrets are owned by `../takos-private`; do not perform production or staging deploys from
  this shell, and do not add private deploy entrypoints that import OSS source paths directly.

Layer rules:

- `app/` may depend on service contracts only, not on implementation packages.
- `git/` must not import `app/` implementation.
- `deploy/` must not import product implementation source paths; connect through published packages, images, APIs, and
  manifests.
- `agent/` may depend on `../takos-agent-engine` as an external path/package.
- Provider plugins must depend on Takosumi plugin contracts/SDK (`jsr:@takos/takosumi-plugins`), not on kernel
  implementation paths.
- The PaaS kernel implementation lives in the standalone Takosumi repository (`../takosumi/`,
  `jsr:@takos/takosumi-kernel`). `deploy/` here only carries Takos-specific deploy artifacts (Helm chart, Terraform,
  distribution manifests) that wrap the upstream kernel.
- The official provider bundle is **Takosumi** (`@takosumi/plugins`, in-tree at `../takosumi/`). Treat it as an
  independent product: distribution manifests reference it by JSR package name and `operator.takosumi.*` plugin ids, not
  by the legacy `@takos-plugins` / `operator.takos.*` names.
- Hosting target ids are now an open enum backed by `registerHostingTarget(...)` from `takosumi-contract/hosting`.
  Adding Azure / Fly.io / OCI etc. is a Takosumi profile + registry-call change, not a contract schema change.

Naming history:

- `takos-paas`, `TAKOS_PAAS_*`, `deployment-paas-*`, and `dev:paas` are pre-split names. Current source paths, service
  ids, Helm resources, env vars, CI tasks, and docs should use `takosumi` / `TAKOSUMI_*` for the kernel/runtime-agent
  boundary. Historical migration notes may mention the old names only when explicitly describing compatibility or
  migration history.
