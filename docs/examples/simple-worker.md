# Simple Worker

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records each run as a **`plan` type Run** then an **`apply` type Run**, with a successful apply updating the **Deployment** and its **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Point an Installation at a Git URL/ref for the OpenTofu module repo.
2. Run a plan and review the resulting `plan` type Run, its proposed changes, and warnings.
3. Apply the reviewed plan; the apply is recorded as an `apply` type Run against that `plan` type Run.
4. A successful `apply` type Run updates the Deployment and writes a new OutputSnapshot; destroy is recorded as `destroy_plan` followed by `destroy_apply`.
5. Connections hold external credential references, ProviderBindings resolve each provider (plus optional alias) to `default`, `connection`, `manual`, or `disabled`, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. OIDC clients, billing, domains, and the dashboard belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, with `var.target` ∈ `aws | gcp | cloudflare`; the `cloudflare` target provisions the backing D1/KV/R2/Queues resources). Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state and run evidence. Connections hold credential references, ProviderBindings resolve per-provider (plus optional alias) bindings, policy resolves provider allowlists and state backend, and the operator distribution owns account-plane policy.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

This creates an Installation that points at the OpenTofu module repo; subsequent typed Runs are recorded as typed Run entries. Takos product routes should call the Takosumi deploy control API or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
