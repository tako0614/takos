# サンプル集

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records each run as a **PlanRun** or **ApplyRun**, with a successful apply updating the **Deployment** and its **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Choose a Git URL/ref for a plain OpenTofu module repo (Takos itself is the module under `deploy/opentofu`, with `var.target ∈ aws | gcp | cloudflare`).
2. Create the Installation against the target RunnerProfile.
3. Run a plan; Takosumi records it as a **PlanRun** and surfaces the proposed changes for review.
4. Apply the reviewed plan; Takosumi records an **ApplyRun**, and a successful apply updates the **Deployment** and **DeploymentOutput**. Destroy runs are also recorded as ApplyRun entries.
5. Provider allowlist, credential references, state backend, execution image/resource limits, and Cloudflare Container execution belong to the RunnerProfile. Account-plane policy, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and the RunnerProfile policy decisions for each run. The operator distribution (Takosumi Accounts) owns account-plane policy such as accounts, billing, OIDC, and the dashboard.

## API Shape

```json
{
  "spaceId": "space_1",
  "runnerProfileId": "runner_default",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "path": "."
  }
}
```

Plan and apply runs are submitted against the Installation, recorded as PlanRun / ApplyRun, and a successful apply updates the Deployment and DeploymentOutput. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
