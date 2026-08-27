# Takos distribution boundary

Takos is a self-hostable product distribution. This repository owns the Takos
Worker source, browser product, agent service, and provider-neutral resource
contract. The complete current OpenTofu adapter is
`deploy/opentofu/cloudflare`.

Takos does not own a deployment control plane. It does not inject provider
credentials, execute production plan/apply/destroy, publish Takosumi releases,
or maintain a second Resource/Run ledger.

## Installation

An operator registers the Git source and installs
`deploy/opentofu/cloudflare` as a Takosumi Capsule. The Provider is bound through
Takosumi. The former `deploy/opentofu/takoform` Provider 1.x projection is not a
current install option because it cannot represent the complete product graph.
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

## Optional Service Form projection

An operator may model the distribution with generic Service Forms such as
`EdgeWorker`, `ContainerService`, `SQLDatabase`, `KVStore`, `ObjectBucket`, and
`Queue`. That projection is hosted by Takosumi and backed by explicit,
versioned adapters. It does not create a Takos-specific lifecycle API or a
catch-all `takosumi_takos` resource.

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
