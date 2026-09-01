# サンプル集

Capsule と Run の流れは [デプロイ管理の概要](/operator/) にあります。

## Current Flow

1. Choose a Git URL/ref for an OpenTofu Capsule repo (Takos publishes peer `deploy/opentofu/takoform` and `deploy/opentofu/cloudflare` modules).
2. Create the Capsule with target ProviderConnection / ProviderBinding settings.
3. Run a plan; Takosumi records it as a **`plan` type Run** and surfaces the proposed changes for review.
4. Apply the reviewed plan; Takosumi records an **`apply` type Run**, and a successful apply updates StateVersion and Output. Destroy uses a reviewed destroy plan followed by destroy apply.
5. ProviderConnections hold credential references, ProviderBindings resolve each provider (plus optional alias) to an explicit connection, and policy resolves provider allowlists, state backend, execution image/resource limits, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos と Takosumi の分担は [Takos の概念](/platform/) にあります。

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

Plan, apply, and destroy Runs are submitted against the Capsule as typed Runs, and a successful apply updates StateVersion and Output. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane Capsule install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi の考え方](https://takosumi.com/docs/concepts/)
- [Takosumi API リファレンス](https://takosumi.com/docs/reference/api)
