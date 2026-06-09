# Takos の概念

This page describes Takosumi v1. Takosumi is an OpenTofu-native deploy control plane that installs a plain OpenTofu module and records an **Installation**, typed **Run** entries, **StateSnapshot**, **OutputSnapshot**, and **Deployment** ledger. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Trigger a **`plan` type Run** and review the recorded plan, changes, and warnings before approval.
3. Apply the reviewed plan as an **`apply` type Run**. A successful apply records **StateSnapshot**, **OutputSnapshot**, and **Deployment**.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to a default / connection / manual / disabled binding, and policy resolves provider allowlists, state backend, and Cloudflare Container execution used by each run.
5. Infrastructure lifecycle credentials, OIDC clients, billing, domains, and account-plane policy belong to the operator distribution (Takosumi Accounts).

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, with `var.target` of `aws`, `gcp`, or `cloudflare`; the `cloudflare` target provisions D1/KV/R2/Queues backing resources). Takosumi records the Installation / Run / Deployment / OutputSnapshot run ledger and policy decisions. The operator distribution (Takosumi Accounts) owns account-plane policy, billing, and OIDC.

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

An Installation created this way is materialized through a typed Run. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
