# Git Source Proof

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Register the Git URL/ref of the OpenTofu Capsule repo as a Source and Capsule.
2. Plan the module. Takosumi records a `plan` type Run with the proposed changes, warnings, and the resolved commit.
3. Apply the reviewed plan. Takosumi records an `apply` type Run; on success it records StateVersion and Output.
4. Destroy is recorded as `destroy_plan` followed by approved `destroy_apply` against the same Capsule.
5. Connections hold credential references, ProviderBindings bind each provider (and optional alias) to an explicit provider connection (an explicit ProviderConnection), and policy resolves provider allowlists, state backend, and Cloudflare Container execution. OIDC clients, billing, domains, and account-plane policy belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions Takos product D1/KV/R2/Queues backing resources, while an external Takosumi control plane records Capsule / Run / StateVersion / Output state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "repo": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "."
  }
}
```

An A Capsule points at a Git URL/ref and module path; plan and apply are recorded as typed Run against it. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
