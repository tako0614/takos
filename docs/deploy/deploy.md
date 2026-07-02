# Takos deployment lifecycle

Takos deploy is an OpenTofu-native, Takosumi-managed distribution lifecycle: `takos/deploy/opentofu` provisions the Takos
product worker backing resources, and the wrangler artifact upload publishes the Takos product surface. The external
Takosumi control plane records the run ledger as **Capsule** plus
**`plan` type Run** -> **`apply` type Run** -> **StateVersion / Output** entries.

## Current Flow

1. Run `tofu apply` for `takos/deploy/opentofu` with `var.target = cloudflare`; this provisions the D1/KV/R2/Queues backing resources.
2. Upload the Takos distribution worker artifact with wrangler, using the module outputs for bindings and routes.
3. Register or update the Takos Capsule from the Git URL/ref and review the recorded **`plan` type Run** before apply.
4. `apply` records StateVersion and Output and keeps policy/audit evidence.

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
