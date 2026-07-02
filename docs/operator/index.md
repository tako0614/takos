# オペレーター向けガイド

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref pointing at a OpenTofu Capsule repo, and a ProviderConnection / ProviderBinding / policy.
2. Run a plan; Takosumi records a `plan` type Run with the reviewed plan, changes, warnings, and policy decision.
3. Apply the reviewed plan; Takosumi records an `apply` type Run, and a successful apply records StateVersion and Output.
4. Destroy is recorded as `destroy_plan` followed by approved `destroy_apply` against the same Capsule, keeping the run ledger append-only.
5. Connections hold credential references, ProviderBindings bind each provider (plus optional alias) used by the module to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, execution image/resource limits, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, domains, and implementation bindings belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions Takos product D1/KV/R2/Queues backing resources, while an external Takosumi control plane records Capsule / Run / StateVersion / Output state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

A plan produces a `plan` type Run; applying the reviewed plan produces an `apply` type Run that records StateVersion and Output. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
