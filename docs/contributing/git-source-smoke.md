# Git Source Proof

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation**, then records a **`plan` type Run** for each plan and an **`apply` type Run** for each apply/destroy. A successful apply updates the **Deployment** and its **OutputSnapshot**. Repo metadata comes from generic information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Register the Git URL/ref of the OpenTofu module repo as an Installation.
2. Plan the module. Takosumi records a `plan` type Run with the proposed changes, warnings, and the resolved commit.
3. Apply the reviewed plan. Takosumi records an `apply` type Run; on success it updates the `Deployment` and `OutputSnapshot`.
4. Destroy is also recorded as an `apply` type Run against the same Installation.
5. Connections hold credential references, ProviderBindings bind each provider (and optional alias) to a default / connection / manual / disabled resolution, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. OIDC clients, billing, domains, and account-plane policy belong to the in-process Accounts plane in the single Takos worker.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, Cloudflare module; it provisions D1/KV/R2/Queues backing resources). Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state. Account-plane policy, billing, and OIDC are owned by the in-process Accounts plane in the single Takos worker.

## API Shape

```json
{
  "spaceId": "space_1",
  "repo": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "."
  }
}
```

An Installation points at a Git URL/ref and module path; plan and apply are recorded as typed Run against it. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
