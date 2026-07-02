# Worker + Container

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Create an Installation from a OpenTofu Capsule repository (Git URL/ref or module path).
2. Trigger a plan; Takosumi records a `plan` type Run with the reviewed plan, warnings, and policy decision.
3. Apply the reviewed plan; Takosumi records an `apply` type Run, and on success records `StateVersion`, `Output`, and `Deployment`.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) the module uses, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Account-plane policy, credentials, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions Takos product D1/KV/R2/Queues backing resources, while an external Takosumi control plane records Capsule / Run / StateVersion / Output state, policy decisions, and audit trail.

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
- [Takosumi specification](https://takosumi.com/docs/reference/model)
