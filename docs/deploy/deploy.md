# Takos deployment lifecycle

Takos owns a provider-neutral resource contract in `deploy/product-resources.json`.
`deploy/opentofu/cloudflare` is its direct Cloudflare adapter and
`deploy/opentofu/takoform` is its
portable Form adapter. Takosumi runs the selected ordinary OpenTofu module and
records the run ledger as **Capsule** plus
**`plan` type Run** -> **`apply` type Run** -> **StateVersion / Output** entries.

## Current Flow

1. Select `deploy/opentofu/takoform` for a portable Form host or `deploy/opentofu/cloudflare` for a directly connected Cloudflare account.
2. Register or update the Takos Capsule from the Git URL/ref and review the recorded **`plan` type Run** before apply.
3. `apply` records StateVersion and Output and keeps policy/audit evidence.
4. The selected adapter materializes the same product-owned runtime connections and immutable artifacts.

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
