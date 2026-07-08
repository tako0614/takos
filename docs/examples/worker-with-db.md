# Worker + DB

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Create a Capsule from a Git URL/ref for the OpenTofu Capsule repo.
2. Run a plan and review the resulting `plan` type Run, its proposed changes, and warnings.
3. Apply the reviewed plan; the apply is recorded as an `apply` type Run against that `plan` type Run.
4. A successful `apply` type Run writes a new StateVersion and Output, which surfaces the database connection details produced by the module; destroy is recorded as `destroy_plan` followed by `destroy_apply`.
5. Connections hold external credential references, ProviderBindings resolve each provider (plus optional alias) to an explicit ProviderConnection provider connection, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. OIDC clients, billing, domains, and the dashboard belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takosumi records Run, StateVersion, Output, policy, and audit evidence and policy decisions. Takosumi Accounts plane owns account-plane policy such as accounts, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

A plan request creates a `plan` type Run; the apply request references that `plan` type Run so only a reviewed plan is applied. Takos product routes should call the Takosumi deploy control plane or the external Takosumi Accounts flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
