# Multi-Service 構成

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module and records an **Installation**, typed **Run** entries, and a successful apply updates the **Deployment** and its **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Trigger a plan; Takosumi records a `plan` type Run against the reviewed module and Connection / ProviderBinding / policy.
3. Apply the reviewed plan; Takosumi records an `apply` type Run and, on success, updates StateSnapshot, OutputSnapshot, and Deployment.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) the module uses, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state and policy decisions. An operator distribution owns account-plane policy, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "deploy/opentofu"
  }
}
```

Creating the Installation records the module reference; subsequent typed Runs record `plan` type Run / `apply` type Run entries against the bound Connection / ProviderBinding / policy. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
