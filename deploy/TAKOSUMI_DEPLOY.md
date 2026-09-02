# Takos distribution boundary

Takos is a self-hostable product distribution. This repository owns the Takos
Worker source, browser product, agent service, and provider-neutral resource
contract. The current product-graph OpenTofu adapter is
`deploy/opentofu/cloudflare`; its optional Cloudflare provider-gap bridge is
off by default, so ordinary production provider applies leave unsupported gaps
unresolved until a reviewed disposable E2E mode is selected.

Takos does not own a deployment control plane. It does not inject provider
credentials, execute production plan/apply/destroy, publish Takosumi releases,
or maintain a second Resource/Run ledger.

## Installation

An operator registers the Git source and installs
`deploy/opentofu/cloudflare` as a Takosumi Capsule. The Provider is bound through
Takosumi. The former `deploy/opentofu/takoform` Provider 1.x projection is not a
current install option because it cannot represent the product graph. For the
Cloudflare gaps that remain outside the ordinary provider path, use the
explicitly reviewed bridge modes documented in `docs/deploy/index.md`.
Takosumi owns the normal Capsule
plan/apply flow, including:

- ProviderConnection, CredentialRecipe, and ProviderBinding resolution;
- runner selection and temporary credential materialization;
- Run, StateVersion, Output, and AuditEvent records;
- plan/apply/destroy authority and operator policy.

Both modules receive ordinary OpenTofu variables. Secret values remain
operator-owned inputs and are materialized only inside the selected Takosumi
runner. Cloudflare-specific runtime secrets are documented in
`deploy/cloudflare/wrangler.toml` and are supplied with `wrangler secret put`,
never through OpenTofu state or outputs. A `TAKOSUMI_ACCOUNTS_TOKEN` is
optional and only needed for server-to-server Capsule calls.

## There is no Service Form projection to choose

`deploy/opentofu/cloudflare` is the only install surface. There is no operator
option to model the distribution with Service Forms instead: the former
Provider 1.x projection under `deploy/opentofu/takoform` is retained as release
history, its HCL is named `main.tf.history` so neither OpenTofu nor Takosumi
source discovery can select it, and it is absent from the Repository manifest.
The retired vocabulary it used (`EdgeWorker`, `SQLDatabase`, `KVStore`,
`ContainerService`, `Queue`) describes that history and names nothing
installable today.

Current Forms also do not cover this product's graph, so the retirement is not
a temporary gap awaiting a provider bump: there is no Form for the vector index
or for the agent container tiers, and `ActorNamespace` does not express the
current Durable Object migration chain. That part of the graph stays in Takos's
native runtime authority. Takosumi integration is proved as an OIDC / Capsule /
Run / Output / Interface consumer, not by projecting Takos onto Forms. Nothing
here creates a Takos-specific lifecycle API or a catch-all `takosumi_takos`
resource.

Runtime integrations such as MCP, file handlers, storage, UI surfaces, and Git
hosting are consumed through Takosumi `Interface` and `InterfaceBinding`
records. OpenTofu Outputs are presentation/lifecycle evidence; they are not a
runtime registry or credential transport.

## Local development and checks

Local Compose is a development substrate, not production deployment authority:

```sh
bun run local:config
bun run local:up
bun run local:smoke
bun run local:down
```

The portable product gate is:

```sh
bun run check
```

Production and incident procedures belong to the operator and Takosumi
documentation. This repository intentionally has no `scripts/control`,
release-gate, admin CLI, secret writer, or Takosumi deployment command. The
release artifact publisher only emits immutable distribution bytes; it does not
perform infrastructure lifecycle operations.
