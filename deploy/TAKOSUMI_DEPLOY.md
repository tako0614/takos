# Takos distribution deployment boundary

Takos is an OpenTofu-native, Takosumi-managed AI workspace distribution. This
repository owns the Takos Worker artifact and the plain OpenTofu module that
describes its durable product backing resources. Takosumi owns deployment
authority, credentials, runners, Run history, StateVersion/Output evidence,
policy, and audit.

There is deliberately no app-local production deploy CLI or GitHub deploy
workflow in this repository. Production deployment runs through a Takosumi
control plane so source, plan, apply, lifecycle results, and audit stay on one
reviewed Run boundary.

## Current install flow

An operator registers `deploy/opentofu` as a Takosumi Capsule and runs the
normal Capsule plan/apply flow. A successful apply records the Run,
StateVersion, Outputs, and AuditEvent in Takosumi. Product artifact publication
is a reviewed, versioned `post_apply` lifecycle action in the Capsule's
service-side InstallConfig; it is not a second deployment authority in Takos.

The lifecycle action invokes the current product activator from the reviewed
source snapshot:

```sh
bun scripts/control/takosumi-release.mjs <environment>
```

The activator reads ordinary, explicitly allowlisted `TAKOSUMI_OUTPUTS_JSON`,
renders generated Wrangler bindings, applies product-owned migrations and
activation steps, and publishes the reviewed Worker artifact. Takosumi treats
the command as an opaque lifecycle action and records its result on the same
Run boundary.

The immutable CI release publishes `install-config-patch.json` beside
`takosumi-artifact.json`. Operators can reproduce that service-side
contribution without reading OpenTofu state:

```sh
bun scripts/control/install-config-from-worker-artifact.mjs \
  takosumi-artifact.json \
  --executor operator \
  --output install-config-patch.json
```

The versioned patch keeps three separate Takosumi fields together:

- `lifecycleActions` selects the reviewed product activator.
- `outputAllowlist` exposes only the ordinary public-safe Outputs required by
  presentation and runtime Interfaces.
- `interfaceBlueprints` declares the Takos launcher surface by explicitly
  mapping its URL to the ordinary `launch_url` Output.

The narrower `lifecycle-config-from-worker-artifact.mjs` command remains
available when an operator intentionally updates only lifecycle policy. The
selected RunnerProfile must advertise `capsule.lifecycle.command.v1` for a
runner action; the operator owns the allowlisted environment and
ProviderConnection policy. Artifact selection, source ref, credentials,
Interface declarations, Output projection, and lifecycle action configuration
are all Takosumi-side data. They are not OpenTofu variables, reserved Outputs,
or repository manifest fields.

## OpenTofu module boundary

The OpenTofu module owns durable topology and provisions only Takos product
backing resources. Takosumi owns the Run and the operator-controlled lifecycle
action that publishes the Worker artifact. Ordinary module Outputs are
projected to the lifecycle action as non-secret values. The generated Wrangler
configuration is based on `deploy/cloudflare/wrangler.toml` and is written to
an ephemeral release path; resource ids and operator domains are never
committed to this repository.

The module may expose product capacity inputs such as queue or container
limits. It must not grow inputs for release executor selection, artifact
publication, Takosumi source pinning, credentials, or a second control plane.
It never fetches `takosumi-artifact.json` during `tofu plan`; the service-side
InstallConfig pins the artifact and lifecycle action reviewed with the Plan.

## Secrets and credentials

Cloudflare and provider credentials belong to the Takosumi ProviderConnection /
CredentialRecipe and are injected only for the reviewed Run or lifecycle
action. Runtime secrets are operator-owned and must not be committed. When a
secret must be set for a self-hosted installation, the operator's Takosumi
runbook may use the normal command form:

```sh
bunx wrangler secret put <NAME> --config deploy/cloudflare/wrangler.toml
```

The command is an operator-side lifecycle operation, not a Takos package
script. `TAKOSUMI_ACCOUNTS_TOKEN`, when enabled by an operator integration, is
also supplied by that external Takosumi control plane; it is not generated or
managed by this repository.

## Local development

Use the Takosumi local-substrate stack for local control-plane and hostname
testing, then run Takos product checks from this repository. Local development
helpers are not production deployment authorities. The relevant product gates
are:

```sh
bun run doctor
bun run check
bun run validate:architecture
bun run release-gate
```

For operator deployment and incident procedures, use the Takosumi operator
documentation. The product repository intentionally contains only the module,
artifact activator, and boundary documentation needed by that flow.
