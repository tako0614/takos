# Takos deployment lifecycle

Takos is deployed by Takosumi as an installed and applied OpenTofu module. Takosumi installs a plain OpenTofu module (Takos ships its module at `deploy/opentofu`) and records the run ledger: an **Installation** plus **PlanRun** → **ApplyRun** → **Deployment** → **DeploymentOutput** entries. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref for the Takos OpenTofu module (`deploy/opentofu`), with `var.target` ∈ `aws` | `gcp` | `cloudflare` (the `cloudflare` target provisions the D1/KV/R2/Queues backing resources).
2. Run a plan and review the recorded **PlanRun** (planned changes, warnings, and policy decision).
3. Apply the reviewed plan as an **ApplyRun**; a successful apply updates the **Deployment** and **DeploymentOutput**.
4. Destroy is also recorded as an **ApplyRun** against the same Installation.
5. The **RunnerProfile** owns the provider allowlist, credential references, state backend, and Cloudflare Container execution. Infrastructure lifecycle, credentials, OIDC clients, billing, and domains belong to the operator distribution; Takosumi records the resulting run ledger and audit trail.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and audit trail. The operator distribution (Takosumi Accounts) owns account / billing / OIDC / dashboard.

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

Plan and apply requests are recorded as PlanRun / ApplyRun entries against the Installation. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/takosumi-v1)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
