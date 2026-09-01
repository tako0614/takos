# yurucommu

Capsule と Run の流れは [デプロイ管理の概要](/operator/) にあります。

## Current Flow

1. Choose a Git URL/ref for the OpenTofu Capsule repository.
2. Create a `plan` type Run and review its proposed changes, warnings, and run ledger entry.
3. Apply the reviewed plan as an `apply` type Run, which records a StateVersion and Output on success.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, and Cloudflare Container execution for the run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, domains, and account-plane policy belong to the Takosumi Accounts plane.

## Takos Boundary

Takos と Takosumi の分担は [Takos の概念](/platform/) にあります。

## API Shape

```json
{
  "spaceId": "space_1",
  "repository": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

`apply` type Run requests reference the reviewed `plan` type Run returned by the plan step. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi の考え方](https://takosumi.com/docs/concepts/)
- [Takosumi API リファレンス](https://takosumi.com/docs/reference/api)
