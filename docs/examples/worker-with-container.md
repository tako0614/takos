# Worker + Container

Capsule と Run の流れは [デプロイ管理の概要](/operator/) にあります。

## Current Flow

1. Create a Capsule from an OpenTofu Capsule repository (Git URL/ref or module path).
2. Trigger a plan; Takosumi records a `plan` type Run with the reviewed plan, warnings, and policy decision.
3. Apply the reviewed plan; Takosumi records an `apply` type Run, and on success records `StateVersion` and `Output`.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) the module uses, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos と Takosumi の分担は [Takos の概念](/platform/) にあります。

## API Shape

```json
{
  "spaceId": "space_1",
  "source": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

A plan produces a `plan` type Run, and the reviewed plan is applied as an `apply` type Run. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi の考え方](https://takosumi.com/docs/concepts/)
