# takos

Takos product shell and local entrypoint.

This repository is intentionally a shell: product implementation lives in nested service repositories, while this repo
owns the local service composition, boundary checks, component matrix, and product-level docs. It should feel like the
front door for Takos, not a place to put shared implementation packages.

```text
takos/
  agent/  -> takos-agent
  app/    -> takos-app
  git/    -> takos-git
  deploy/ -> Takos deploy artifacts (helm/terraform/distributions). Kernel itself is external (jsr:@takos/takosumi-kernel)
  docs/   -> shell-owned product architecture, runbooks, and planning docs
```

`takos-agent-engine` is a Rust library, not a Takos service. It remains an independent checkout at the ecosystem root
and is not vendored into any service repo.

## Quick Start

```sh
git submodule update --init --recursive
deno task doctor
deno task local:config
deno task local:up
```

Useful shell tasks:

- `deno task doctor`: human-readable tool, submodule, compose, and boundary diagnostics.
- `deno task check`: strict lightweight shell check for automation.
- `deno task local:config`: render the local compose config without starting services.
- `deno task local:up` / `deno task local:down` / `deno task local:logs`: run the local shell.
- `deno task local:smoke`: check the four local service health endpoints.
- `deno task local:e2e`: run the isolated docker compose e2e smoke used by CI, including a seeded Smart HTTP git clone
  through apps/api.
- `deno task docs:dev` / `deno task docs:build`: work on the shell docs.
- `deno task helm:generate-overlays` / `deno task helm:check-overlays`: generate or verify AWS/GCP Helm overlays from
  distribution profiles.
- `deno task helm:template-smoke`: run Helm v3 template smoke for the base/AWS/GCP chart values. Set
  `TAKOS_HELM_REQUIRE_INSTALL_DRY_RUN=1` in a kubeconfig-backed environment to require client install dry-run cases too.
  CI also sets `TAKOS_HELM_INSTALL_TEST_CRDS=1` so kind can validate the GCP ManagedCertificate resource.
- `deno task helm:install-smoke`: run a real Helm install/status/manifest/uninstall smoke against the current Kubernetes
  context for the base/AWS/GCP chart values.
- `deno task validate:distributions`: verify official distribution profiles against the schema contract, artifact refs,
  target-specific bindings, service specs, provider proof commands, fixtures, and service smoke metadata.
- `deno task validate:service-set`: verify the Helm chart exposes only `takos-app`, `takosumi`, `takosumi-cloud`,
  `takos-git`, and `takos-agent`, with operator-overridable images.
- `deno task submodules:update`: initialize or refresh nested service checkouts.

## Boundary Names

Product-level architecture and planning docs live under `docs/` at this shell level. Product roots may link to those
plans, but the docs tree is not owned by any product implementation root and must not contain product implementation
code.

Use the split repository boundaries below when adding docs, scripts, imports, or local composition. Do not reintroduce
pre-split path references such as `takos/apps` or `takos/packages`, path-level legacy references, or stale service names
such as `control-legacy`, `runtime-legacy`, or `takos-web`. Keep compatibility behavior and legacy data migrations
documented where they are still part of the contract, but avoid using legacy names as current source paths or service
identities.

### Naming History

Earlier Takos branches used names such as `takos-paas`, `TAKOS_PAAS_*`, `deployment-paas-*`, and `dev:paas` for the
deploy/runtime layer. The current boundary is Takosumi: use `takosumi`, `TAKOSUMI_*`, and `takosumi-*` resource names
for current source, CI, local compose, Helm, and operator docs. Mention the old names only in migration or compatibility
history.

## Responsibility Split

- `app`: Takos-facing OIDC consumer sessions, app-local profiles/settings, user-facing management UI, public/browser/CLI
  API gateway, and product API that is not owned by another Takos service. Takosumi Accounts (`../takosumi-cloud`) owns
  identity, billing, OAuth/OIDC issuer behavior, client registry, consent/device flow, and AppInstallation ownership.
- `deploy`: Takos product distribution profiles, the distribution schema contract, Helm/Terraform modules, distribution
  manifests, and validators that wrap published packages, images, APIs, and manifests.
- `takosumi` (external sibling `../takosumi`): tenant/platform management, deploy and runtime lifecycle domains,
  resource/routing/publication domains, and internal control API.
- `git`: Git hosting, Git Smart HTTP, repositories/source, refs, object storage, source resolution, and repository API
  contracts.
- `agent`: agent execution service. It calls PaaS internal control RPC.

Deploy and runtime lifecycle semantics are canonical in Takosumi domains and public/internal control APIs. Takos product
distribution overlays live in `deploy/`. Service contracts should be exported by the owning core service.

Browser and CLI clients talk to `takos-app`. `takos-app` verifies public sessions/tokens and calls internal services
with signed internal requests carrying actor context. Internal services do not verify browser cookies or public OAuth
tokens directly.

## Local Checkout

```sh
git submodule update --init --recursive
```

The planned remote repositories are:

- `https://github.com/tako0614/takosumi.git`
- `https://github.com/tako0614/takos-git.git`
- `https://github.com/tako0614/takos-app.git`
- `https://github.com/tako0614/takos-agent.git`

## Local Compose

```sh
deno task local:up
```

The local compose entrypoint should expose the core service set: `takos-app`, `takos-git`, `takosumi`, `takosumi-cloud`,
and `takos-agent`. Do not add standalone deploy or runtime services to this shell compose file; those lifecycles are
local process roles and domains of `takosumi`.

See also:

- [Service Topology](docs/architecture/service-topology.md)
- [Local Shell Runbook](docs/get-started/local-shell.md)
- [Component Matrix](docs/reference/component-matrix.md)
