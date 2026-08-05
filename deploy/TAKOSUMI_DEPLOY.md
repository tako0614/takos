# Takos distribution boundary

Takos is a self-hostable product distribution. This repository owns the Takos
Worker source, browser product, agent service, and provider-neutral resource
contract. The ordinary OpenTofu adapters live side by side under
`deploy/opentofu/takoform` and `deploy/opentofu/cloudflare`.

Takos does not own a deployment control plane. It does not inject provider
credentials, execute production plan/apply/destroy, publish Takosumi releases,
or maintain a second Resource/Run ledger.

## Installation

An operator registers the Git source and selects one of the two adapter module
paths as a Takosumi Capsule. `deploy/opentofu/takoform` is the portable default;
`deploy/opentofu/cloudflare` is the advanced direct-Cloudflare option. The
selected provider is bound through Takosumi. Takosumi owns the normal Capsule
plan/apply flow, including:

- ProviderConnection, CredentialRecipe, and ProviderBinding resolution;
- runner selection and temporary credential materialization;
- Run, StateVersion, Output, and AuditEvent records;
- plan/apply/destroy authority and operator policy.

Both modules receive ordinary OpenTofu variables. Secret values remain
operator-owned inputs and are materialized only inside the selected Takosumi
runner. The narrow `product:activate` lifecycle command reads the declared
0600 runtime-secret file and passes it to the pinned local Wrangler process
when the direct Cloudflare adapter is selected; it never generates, stores,
logs, or returns those values. Cloudflare-specific runtime secrets are
documented in `deploy/cloudflare/wrangler.toml` and are supplied with
`wrangler secret put`, never through OpenTofu state or outputs. A
`TAKOSUMI_ACCOUNTS_TOKEN` is optional and only needed for server-to-server
Capsule calls.

After apply, Takosumi may invoke the Takos-owned artifact materializer described
in [`docs/deploy/product-materializer.md`](../docs/deploy/product-materializer.md).
It consumes the Plan-pinned SourceSnapshot identity and non-sensitive outputs,
but creates no Takos ledger and has no plan/apply/destroy authority.

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
single product materializer is an opaque lifecycle command executed by the
Takosumi runner, not a restored product-local control plane.
