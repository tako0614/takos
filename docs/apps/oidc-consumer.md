# OIDC Consumer

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records an **Installation**, then a **PlanRun**, an **ApplyRun**, and a resulting **Deployment** plus **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Create an **Installation** from a Git URL/ref pointing at a plain OpenTofu module.
2. Record a **PlanRun** and review its plan diff, warnings, and policy decision.
3. Approve the reviewed plan, then record an **ApplyRun** that materializes the topology.
4. A successful ApplyRun updates the **Deployment** and **DeploymentOutput**; subsequent runs reconcile against the recorded Deployment to prevent stale approvals.
5. Provider allowlist, credentials, state backend, and Cloudflare Container execution belong to the **RunnerProfile**. OIDC clients, billing, domains, and dashboard belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed and applied OpenTofu module (`deploy/opentofu`, `var.target` ∈ `aws` | `gcp` | `cloudflare`; the cloudflare target provisions D1/KV/R2/Queues backing resources). Takosumi records the Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput run ledger. The operator distribution owns account-plane policy, OIDC clients, billing, and dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

A PlanRun records the plan to review; an ApplyRun references the approved plan to update the Deployment. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)

## Managed offering gate

OIDC clients for public managed installs are opened by the operator account
plane only after operator approval. Until the managed offering gate is opened,
the public OIDC authorization, token, upstream OAuth, and passkey surfaces stay
closed for new public access.
