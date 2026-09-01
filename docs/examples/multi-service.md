# Multi-Service 構成

Capsule と Run の流れは [デプロイ管理の概要](/operator/) にあります。

## Current Flow

1. Create a Capsule from a Git URL/ref pointing at an OpenTofu module.
2. Trigger a plan; Takosumi records a plan Run against the reviewed module and ProviderConnection / ProviderBinding / policy.
3. Apply the reviewed plan; Takosumi records an apply Run and, on success, updates StateVersion and Output.
4. ProviderConnections hold credential references, ProviderBindings resolve each provider (plus optional alias) the module uses, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos と Takosumi の分担は [Takos の概念](/platform/) にあります。

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "deploy/opentofu/takoform"
  }
}
```

Creating the Capsule records the module reference; subsequent typed Runs record `plan` type Run / `apply` type Run entries against the bound ProviderConnection / ProviderBinding / policy. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi の考え方](https://takosumi.com/docs/concepts/)
- [Takosumi API リファレンス](https://takosumi.com/docs/reference/api)
