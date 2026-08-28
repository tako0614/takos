# Takos deployment lifecycle

Takos owns a provider-neutral resource contract in `deploy/product-resources.json`.
`deploy/opentofu/cloudflare` is its current product-graph adapter. Cloudflare provider gaps remain explicit until the
reviewed bridge is selected for a disposable E2E. Takosumi runs the ordinary OpenTofu module and
records the run ledger as **Capsule** plus
**`plan` type Run** -> **`apply` type Run** -> **StateVersion / Output** entries.

## Current Flow

1. Select `deploy/opentofu/cloudflare` with a directly connected Cloudflare account. The former Provider 1.x Takoform projection is not a current install option.
2. Register or update the Takos Capsule from the Git URL/ref and review the recorded **`plan` type Run** before apply.
3. `apply` records StateVersion and Output and keeps policy/audit evidence.
4. The adapter materializes the product-owned runtime connections and immutable artifacts.

## Cloudflare provider-gap bridge

The direct Cloudflare adapter declares the product graph, but its provider-gap bridge is disabled by default, so
ordinary production provider applies do not silently fill unsupported gaps. Set
`cloudflare_provider_gap_bridge_mode = "staging"` with `environment = "staging"` only for disposable staging smoke inputs. A disposable production E2E must
select `"disposable-production"` with `environment = "production"` and set
`cloudflare_provider_gap_bridge_acknowledgement = "DISPOSABLE_PRODUCTION_ONE_SHOT"`; any other acknowledgement fails closed.
The bridge is app-owned and covers only Vectorize, D1 migrations, container-enabled Durable Object migration, and Container
application reconciliation. Destroy invokes ownership-proven cleanup for bridge-created Container applications and the Vectorize
index; it does not roll back D1 data.

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
