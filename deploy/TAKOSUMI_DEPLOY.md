# Deploying Takos via Takosumi

## Overview

**Takos is a product that runs on Takosumi.** Takos's whole deploy topology — the worker, its backing resources, and the
egress / runtime-host / executor services — is the OpenTofu module in [`opentofu/`](opentofu) (`var.target` ∈
`aws | gcp | cloudflare`; the `cloudflare` target provisions the D1 / KV / R2 / Queues resources the Worker layer binds
to). Takosumi, the OpenTofu-native deploy control plane, **installs and applies** that module and records the run ledger:

- **Installation** — Takosumi resolves the Takos OpenTofu module repo (Git URL / commit / module path) into an
  Installation. No Takosumi-specific manifest is required; metadata comes from Git and well-known OpenTofu outputs.
- **PlanRun** — `tofu plan` against the Installation, producing a reviewable plan.
- **ApplyRun** — `tofu apply` (or destroy) of the reviewed plan.
- **Deployment / DeploymentOutput** — a successful ApplyRun updates the Deployment and records the non-secret service URLs
  / binding map as DeploymentOutput.
- **RunnerProfile** — owns the provider allowlist, credential references, state backend, execution limits, and Cloudflare
  Container execution for those runs.

This gives unified deployment tracking, reviewed plans, and an audit ledger across plan / apply / destroy.

## Source of truth

The OpenTofu module in [`opentofu/`](opentofu), as installed and applied by Takosumi, is the source of truth for the
deploy topology. The hand-maintained wrangler / helm / distribute pipeline
(`takos-private/apps/control/cloudflare/wrangler.*.toml` and friends) is the **interim reference materialization** of that
same topology and converges onto the Takosumi-applied module — it is not a separate source of truth.

## Current Status

Run-ledger groundwork complete — end-to-end apply against a live Takosumi deploy control plane is NOT YET VALIDATED.

The OpenTofu module composes all three targets, but no staging or production ApplyRun has been driven end-to-end through a
live Takosumi instance. Until that is validated, the interim wrangler / helm materialization is used to materialize the
same topology.

### Known Limitations

- No staging PlanRun / ApplyRun has been driven end-to-end against a live Takosumi deploy control plane.
- The interim wrangler / helm materialization and the Takosumi-applied module have not yet been reconciled in a real CI
  environment.

### Next Steps

1. Register the Takos OpenTofu module as a Takosumi Installation against the staging RunnerProfile.
2. Produce a PlanRun and review the plan.
3. Drive an ApplyRun in staging alongside the interim wrangler materialization and compare the resulting Deployment /
   DeploymentOutput.
4. Switch staging to the Takosumi-applied module as the sole materialization and monitor for one release cycle.
5. Repeat steps 1–4 for production.

## Migration Path

1. Create the staging Installation from the OpenTofu module repo.
2. Review a PlanRun in staging.
3. Run an ApplyRun in staging alongside the interim wrangler materialization and compare the Deployment /
   DeploymentOutput.
4. Switch staging to the Takosumi-applied module as the sole materialization.
5. Repeat for production.
