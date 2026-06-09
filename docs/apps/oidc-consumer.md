# OIDC Consumer

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records an **Installation**, then a **`plan` type Run**, an **`apply` type Run**, and a resulting **Deployment** plus **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Create an **Installation** from a Git URL/ref pointing at a plain OpenTofu module.
2. Record a **`plan` type Run** and review its plan diff, warnings, and policy decision.
3. Approve the reviewed plan, then record an **`apply` type Run** that materializes the topology.
4. A successful `apply` type Run updates the **Deployment** and **OutputSnapshot**; subsequent runs reconcile against the recorded Deployment to prevent stale approvals.
5. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. OIDC clients, billing, domains, and dashboard belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, `var.target` ∈ `aws` | `gcp` | `cloudflare`; the cloudflare target provisions D1/KV/R2/Queues backing resources). Takosumi records the Installation / Run / Deployment / OutputSnapshot run ledger. The operator distribution owns account-plane policy, OIDC clients, billing, and dashboard.

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

A `plan` type Run records the plan to review; an `apply` type Run references the approved plan to update the Deployment. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane flow instead of exposing a separate deployment proxy.

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
