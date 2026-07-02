# takos-computer

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref pointing at a OpenTofu Capsule.
2. Run a plan; Takosumi records a `plan` type Run with the reviewed plan, changes, and warnings.
3. Apply the reviewed plan; Takosumi records an `apply` type Run and, on success, updates the StateVersion and Output.
4. Destroy is recorded as `destroy_plan` followed by approved `destroy_apply` so teardown stays reviewable and tied to the Capsule's current StateVersion / Output evidence.
5. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, execution image, and Cloudflare Container execution; account-plane policy, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

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

An apply request references the reviewed `plan` type Run, and Takosumi records the resulting `apply` type Run, StateVersion and Output. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi deploy model](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
