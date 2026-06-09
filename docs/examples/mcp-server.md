# MCP Server

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module repository and records an **Installation**, then a **`plan` type Run**, an **`apply` type Run**, and the resulting **Deployment** with its **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref pointing at the OpenTofu module repository.
2. Create an **Installation**, then start a **`plan` type Run** and review its diff, warnings, and policy decision.
3. Promote the reviewed plan to an **`apply` type Run**; a successful apply updates the **Deployment** and its **OutputSnapshot**.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) the module uses, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, domains, and dashboard surface belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, with `var.target` in `aws | gcp | cloudflare`). Takosumi records the Installation / Run / Deployment / OutputSnapshot run ledger. Takosumi or another operator distribution owns account / billing / OIDC / dashboard.

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

A `plan` type Run is reviewed before it is promoted to an `apply` type Run. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
