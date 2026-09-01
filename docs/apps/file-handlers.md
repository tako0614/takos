# File Handlers

File handlers let installed apps open or edit selected file types from a Workspace. Takos discovers them through
Capsule output projection, not through a Takos-specific manifest.

## Current Flow

1. Install an app Capsule from Git.
2. Review and apply the Takosumi plan.
3. The app exposes non-secret service metadata with a capability such as `interface.file.handler`.
4. Takos reads the bound export and shows the handler for matching files in the Workspace.
5. Runtime authority, when needed, comes from the deployed runtime/account-plane boundary rather than OpenTofu output values.

## Takos Boundary

Takos と Takosumi の分担は [Takos の概念](/platform/) にあります。

## Install Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "source": "github.com/example/takos//deploy/opentofu/cloudflare",
    "ref": "main"
  }
}
```

Selecting an adapter runs a `plan` type Run and then an `apply` type Run, which records StateVersion and
non-sensitive endpoints as Output. Takos product routes rely on the Takosumi deploy-control ledger and
Capsule output projection instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi の考え方](https://takosumi.com/docs/concepts/)
- [Takosumi API リファレンス](https://takosumi.com/docs/reference/api)
