# ルーティング

Takosumi is the OpenTofu-native deploy control plane that runs Takos. It installs a plain OpenTofu module repository and records an **Installation** and the run ledger: **PlanRun → ApplyRun → Deployment → DeploymentOutput**. A **RunnerProfile** owns the provider allowlist, credentials, state backend, and Cloudflare Container execution. Repository metadata comes from generic information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

Takos itself is deployed by Takosumi as the installed-and-applied OpenTofu module at `deploy/opentofu`, with `var.target` ∈ `aws | gcp | cloudflare` (the `cloudflare` target provisions D1/KV/R2/Queues backing resources). wrangler/helm/distribute is the interim materialization of that topology, not a separate source of truth.

## Current Flow

1. Choose a Git URL/ref pointing at the OpenTofu module repository.
2. Create an Installation under a RunnerProfile, then run a plan. Review the resulting **PlanRun** changes and warnings.
3. Apply the reviewed plan. A successful **ApplyRun** updates the **Deployment** and **DeploymentOutput**.
4. Destroy runs are recorded as ApplyRun entries against the same Installation, so the ledger stays append-only and auditable.
5. Provider allowlist, credentials, state backend, and Cloudflare Container execution belong to the RunnerProfile. Billing, OIDC clients, domains, and dashboard belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and RunnerProfile policy decisions. The operator distribution (Takosumi Accounts) owns account, billing, OIDC, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

Apply requests reference the reviewed PlanRun returned by the plan step. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
