# index

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a Git-hosted OpenTofu Capsule as an **Installation**, records each source sync / compatibility check / plan / apply / destroy as a **Run**, and records a successful apply as a **Deployment** plus **OutputSnapshot**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path. Takos itself can be installed through Takosumi as a normal OpenTofu Capsule (`deploy/opentofu`, with `var.target` ∈ `aws` | `gcp` | `cloudflare`), but Takos self-host does not require Takosumi.

## Current Flow

1. Point an Installation at a plain OpenTofu module repo by Git URL/ref.
2. Create a plan **Run** and review the recorded plan, changes, and warnings.
3. Approve the reviewed plan and apply it as an apply **Run**.
4. A successful `apply` type Run updates the **Deployment** and its **OutputSnapshot**.
5. Connections, ProviderBindings (one binding per provider and optional alias), and policy resolve provider credentials, provider allowlists, state handling, and runner boundaries; account-plane policy, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state and policy decisions. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and the dashboard.

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

An Installation references the OpenTofu Capsule repo; a `plan` type Run records the reviewed plan, and an `apply` type Run applies that saved plan. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
