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

The module receives ordinary OpenTofu variables. Secret values remain
operator-owned inputs and are materialized only inside the selected Takosumi
runner. A `TAKOSUMI_ACCOUNTS_TOKEN` is optional and only needed for
server-to-server Capsule calls.

## Runtime secrets

The Takos Worker reads five runtime secrets: `ENCRYPTION_KEY`,
`TAKOS_AGENT_START_TOKEN`, `TAKOS_INTERNAL_API_SECRET`, `PLATFORM_PRIVATE_KEY`,
and `PLATFORM_PUBLIC_KEY`. `deploy/opentofu/cloudflare` names them and holds no
value for any of them. A Takosumi Run persists OpenTofu state as a StateVersion,
so a value minted inside the module would be a published secret. Runtime secrets
are documented in `deploy/cloudflare/wrangler.toml` and are supplied with
`wrangler secret put`, never through OpenTofu state or outputs.

`.well-known/takosumi.json` is `takosumi.com/v2.4` and requests the three
symmetric secrets as `secret.generated` requirements delivered to the exact
runtime binding names. That is the only shape a repository may request: exactly
32 bytes, hex-encoded, delivered to a binding. It fits `ENCRYPTION_KEY`
(the Worker hex-decodes a 64-character value into a 32-byte PBKDF2 input),
`TAKOS_AGENT_START_TOKEN`, and `TAKOS_INTERNAL_API_SECRET`, which are compared
as opaque strings.

`PLATFORM_PRIVATE_KEY` and `PLATFORM_PUBLIC_KEY` stay operator-supplied. The
Worker imports the private key with `jose.importPKCS8(pem, "RS256")` to sign the
short-lived runtime-service JWT, so the value is an RSA-2048 PKCS#8 PEM. No
generated-secret shape expresses a key pair, the Worker has no deterministic
derivation from seed bytes, and a repository manifest cannot request the host's
operator-owned RSA key-pair material. Generate the pair with
`bun run generate:keys` and load it with `wrangler secret put`.

Whether a host mints the requested values depends on the host lane. Takosumi
delivers manifest-requested generated secrets through a provider that declares
the run-scoped sensitive input protocol in its CredentialRecipe; the upstream
Cloudflare provider does not, so on this BYOC module the request is currently
inert and all five values are operator-supplied. The requirement is declared
anyway because it is the repository's statement of what the app needs, and it is
satisfied without a manifest change on any host lane that can deliver it.

The module binds the five names with the Cloudflare `inherit` binding type,
which carries an existing value forward without sending it. A first install has
no previous Worker version to inherit from, so the sequence is:

1. apply with `runtime_secrets_provisioned = false`; the Worker serves `503` on
   every path except `/health` until its secrets exist;
2. load the five values with `wrangler secret put`;
3. apply again with `runtime_secrets_provisioned = true`.

After that, every later apply preserves the operator-owned values instead of
publishing a Worker version that silently drops them.

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
