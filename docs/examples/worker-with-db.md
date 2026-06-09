# Worker + DB

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records each run as a **`plan` type Run** then an **`apply` type Run**, with a successful apply updating the **Deployment** and its **OutputSnapshot**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path. A Worker-plus-DB topology is provisioned by the OpenTofu module itself; on Cloudflare it backs the Worker with D1/KV/R2/Queues resources.

## Current Flow

1. Point an Installation at a Git URL/ref for the OpenTofu module repo.
2. Run a plan and review the resulting `plan` type Run, its proposed changes, and warnings.
3. Apply the reviewed plan; the apply is recorded as an `apply` type Run against that `plan` type Run.
4. A successful `apply` type Run updates the Deployment and writes a new OutputSnapshot, which surfaces the database connection details produced by the module; destroy is recorded as `destroy_plan` followed by `destroy_apply`.
5. Connections hold external credential references, ProviderBindings resolve each provider (plus optional alias) to `default`, `connection`, `manual`, or `disabled`, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. OIDC clients, billing, domains, and the dashboard belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state and policy decisions. Takosumi or another operator distribution owns account-plane policy such as accounts, billing, OIDC, and the dashboard.

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

A plan request creates a `plan` type Run; the apply request references that `plan` type Run so only a reviewed plan is applied. Takos product routes should call the Takosumi deploy control plane or the operator distribution account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
