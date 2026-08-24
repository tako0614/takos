# Takos deployment lifecycle

Takos owns a provider-neutral resource contract in `deploy/product-resources.json`.
`deploy/opentofu/cloudflare` is its complete current adapter. Takosumi runs the ordinary OpenTofu module and
records the run ledger as **Capsule** plus
**`plan` type Run** -> **`apply` type Run** -> **StateVersion / Output** entries.

## Current Flow

1. Select `deploy/opentofu/cloudflare` with a directly connected Cloudflare account. The former Provider 1.x Takoform projection is not a current install option.
2. Register or update the Takos Capsule from the Git URL/ref and review the recorded **`plan` type Run** before apply.
3. `apply` records StateVersion and Output and keeps policy/audit evidence.
4. The adapter materializes the product-owned runtime connections and immutable artifacts.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records Run, StateVersion, Output, policy, and audit evidence and audit trail for the distribution lifecycle. The Takosumi Accounts plane owns account /
billing / OIDC / dashboard for the worker distribution.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

Plan and apply requests are recorded as typed Run entries against the Capsule. Takos product routes should use that
ledger instead of introducing a separate deploy shortcut.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi model](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
