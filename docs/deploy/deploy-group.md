# Run History

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Create a Capsule from a Git URL/ref pointing at a OpenTofu Capsule.
2. Run `plan` to produce a **`plan` type Run** and review its proposed changes, warnings, and policy decision.
3. Apply the reviewed plan to produce an **`apply` type Run**; a successful apply records StateVersion and Output.
4. Destroy is recorded as a two-phase **`destroy_plan` -> approval -> `destroy_apply`** flow against the same Capsule, keeping the run ledger append-only.
5. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection, and policy resolves provider allowlists, state backend, execution image / resource limits, and Cloudflare Container execution; account-plane concerns (credentials issuance, OIDC clients, billing, domains, dashboard) belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions Takos product D1/KV/R2/Queues backing resources, while an external Takosumi control plane records Capsule / Run / StateVersion / Output state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu"
  }
}
```

An apply targets a reviewed `plan` type Run and records an `apply` type Run against the Capsule. Takos product routes should call the Takosumi deploy control plane or the operator account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
