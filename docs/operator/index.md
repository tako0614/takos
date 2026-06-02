# オペレーター向けガイド

This page has been reset for Takosumi v1. Takosumi is the OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records a run ledger of **PlanRun**, **ApplyRun**, **Deployment**, and **DeploymentOutput** entries. Installation display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref pointing at a plain OpenTofu module repo, and a RunnerProfile.
2. Run a plan; Takosumi records a `PlanRun` with the reviewed plan, changes, warnings, and runner profile policy decision.
3. Apply the reviewed plan; Takosumi records an `ApplyRun`, and a successful apply updates the `Deployment` and `DeploymentOutput`.
4. Destroy is recorded as an `ApplyRun` against the same Installation, keeping the run ledger append-only.
5. Provider allowlist, credential references, state backend, execution image/resource limits, and Cloudflare Container execution are owned by the RunnerProfile. Account-plane policy, OIDC clients, billing, domains, and implementation bindings belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed and applied OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws` | `gcp` | `cloudflare`; the `cloudflare` target provisions the D1/KV/R2/Queues backing resources). Takosumi records the Installation, PlanRun, ApplyRun, Deployment, and DeploymentOutput run ledger. A RunnerProfile owns the execution boundary, and the operator distribution owns account-plane policy and implementation bindings.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  },
  "runnerProfileId": "rp_default"
}
```

A plan produces a `PlanRun`; applying the reviewed plan produces an `ApplyRun` that updates the `Deployment` and `DeploymentOutput`. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
