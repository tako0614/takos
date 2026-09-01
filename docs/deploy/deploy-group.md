# Run History

Capsule と Run の流れは [デプロイ管理の概要](/operator/) にあります。

## Current Flow

1. Create a Capsule from a Git URL/ref pointing at a OpenTofu Capsule.
2. Run `plan` to produce a **`plan` type Run** and review its proposed changes, warnings, and policy decision.
3. Apply the reviewed plan to produce an **`apply` type Run**; a successful apply records StateVersion and Output.
4. Destroy is recorded as a two-phase **`destroy_plan` -> approval -> `destroy_apply`** flow against the same Capsule, keeping the run ledger append-only.
5. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection, and policy resolves provider allowlists, state backend, execution image / resource limits, and Cloudflare Container execution; account-plane concerns (credentials issuance, OIDC clients, billing, domains, dashboard) belong to the Takosumi Accounts plane.

## Takos Boundary

Takos と Takosumi の分担は [Takos の概念](/platform/) にあります。

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu/takoform"
  }
}
```

An apply targets a reviewed `plan` type Run and records an `apply` type Run against the Capsule. Takos product routes should call the Takosumi deploy control plane or the operator account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi の考え方](https://takosumi.com/docs/concepts/)
- [Takosumi API リファレンス](https://takosumi.com/docs/reference/api)
