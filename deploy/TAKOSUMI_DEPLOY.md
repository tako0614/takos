# Deploying Takos (and the optional Takosumi run ledger)

## Overview

**Takos is complete as a plain OpenTofu module.** Anyone can stand up a self-hosted Takos with no Takosumi involved.
Takos's whole deploy topology — the worker, its backing resources, and the egress / runtime-host / executor services — is
the OpenTofu module in [`opentofu/`](opentofu) (`var.target` ∈ `aws | gcp | cloudflare`; the `cloudflare` target
provisions the D1 / KV / R2 / Queues / Durable Object / container resources the Worker layer binds to). Self-hosting is
two steps:

1. **`tofu apply`** the module against your own infrastructure. This provisions every durable resource and publishes the
   well-known OpenTofu outputs (service URLs, binding map).
2. **One wrangler step** uploads the worker artifact (the worker script + assets + containers + Durable Object
   migrations) that reads those module outputs. This is the half of the deploy the Terraform/OpenTofu provider cannot
   express; the wrangler config at [`cloudflare/wrangler.toml`](cloudflare/wrangler.toml) is that worker-artifact half of
   the same deploy.

That is the entire self-host path. **Takosumi is not required.**

## Takosumi is an optional convenience

Running the *same* OpenTofu module **through Takosumi** is optional. When you do, Takosumi — the OpenTofu-native deploy
control plane — installs and applies the module and records a run ledger on top, adding reviewed plans, policy decisions,
an audit trail, and a dashboard:

- **Installation** — Takosumi resolves the Takos OpenTofu module repo (Git URL / commit / module path) into an
  Installation. Metadata comes from Git and well-known OpenTofu outputs.
- **Run** — `source_sync`, `compatibility_check`, `plan`, `apply`, `destroy_plan`, and `destroy_apply` are recorded as
  Run entries against the Installation.
- **StateSnapshot / OutputSnapshot / Deployment** — a successful `apply` type Run advances the state generation, records
  non-secret service URLs and binding maps as an OutputSnapshot, and updates the Deployment.
- **Connection / ProviderBinding / policy** — provider credentials, provider/resource allowlists, state handling, and
  runner execution limits are resolved through the Installation's per-provider (+ optional alias) bindings and policy;
  container execution details stay internal to the runner.

This gives unified deployment tracking, reviewed plans, and an audit ledger across plan / apply / destroy. Takos holds no
architectural privilege here: to Takosumi it is just one plain OpenTofu module app among others. The module being applied
is identical whether you run `tofu apply` yourself or route it through Takosumi.

## Source of truth

The OpenTofu module in [`opentofu/`](opentofu) is the source of truth for the **durable** deploy topology, whether it is
applied directly with `tofu apply` or installed and applied by Takosumi. The wrangler config
(`cloudflare/wrangler.toml`, and the private `takos-private/` materialization that derives from it) is the
**worker-artifact half** of the same deploy — the bindings, containers, routes, and DO migrations the provider cannot
declare. The two halves describe one deploy and must stay in sync; the wrangler half is not a competing source of truth
for the durable infra.

## Current Status

Direct `tofu apply` + wrangler self-host is the complete, supported path. The optional Takosumi run-ledger path has its
groundwork complete, but an end-to-end apply against a live Takosumi deploy control plane is NOT YET VALIDATED.

The OpenTofu module composes all three targets. No staging or production `apply` type Run has been driven end-to-end through a
live Takosumi instance yet; until that is validated, self-hosters use the direct `tofu apply` + wrangler path (and the
private materialization derived from it) to realize the same topology.

### Known Limitations

- No staging typed Runs have been driven end-to-end against a live Takosumi deploy control plane.
- The direct-apply wrangler materialization and the Takosumi-applied module have not yet been reconciled in a real CI
  environment.

### Next Steps (to validate the optional Takosumi path)

1. Register the Takos OpenTofu module as a Takosumi Installation with staging Connection / ProviderBinding settings.
2. Produce a `plan` type Run and review the plan.
3. Drive an `apply` type Run in staging alongside the direct wrangler materialization and compare the resulting Deployment /
   OutputSnapshot.
4. Confirm the Takosumi-applied module yields the same topology as the direct path, then monitor for one release cycle.
5. Repeat steps 1–4 for production.

## Optional-Takosumi Adoption Path

1. Create the staging Installation from the OpenTofu module repo.
2. Review a `plan` type Run in staging.
3. Run an `apply` type Run in staging alongside the direct wrangler materialization and compare the Deployment /
   OutputSnapshot.
4. Adopt the Takosumi-applied module as the staging materialization once the outputs match.
5. Repeat for production.
