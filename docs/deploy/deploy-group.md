# Deployment History

This page has been reset for Takosumi v1. Takosumi installs a plain OpenTofu module and records an **Installation**, typed **Run** entries for `plan` / `apply` / `destroy`, and a successful apply updates the **Deployment** and its **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Run `plan` to produce a **`plan` type Run** and review its proposed changes, warnings, and policy decision.
3. Apply the reviewed plan to produce an **`apply` type Run**; a successful apply updates the **Deployment** and records its **OutputSnapshot**.
4. `destroy` is recorded as an **`apply` type Run** against the same Installation, keeping the run ledger append-only.
5. Connections hold credential references, ProviderBindings resolve the connection for each provider (+ optional alias), and policy resolves provider allowlists, state backend, execution image / resource limits, and Cloudflare Container execution; account-plane concerns (credentials issuance, OIDC clients, billing, domains, dashboard) belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, with `var.target` in aws / gcp / cloudflare). Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state through a Connection / ProviderBinding / policy. An operator distribution owns account-plane policy such as accounts, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu"
  }
}
```

An apply targets a reviewed `plan` type Run and records an `apply` type Run against the Installation. Takos product routes should call the Takosumi deploy control plane or the operator account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
