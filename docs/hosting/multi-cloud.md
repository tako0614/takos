# Multi-cloud

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records an **Installation**, then **PlanRun** / **ApplyRun** entries, and on a successful apply a **Deployment** with its **DeploymentOutput**. Module display metadata comes from generic repository information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

Takos itself is deployed this way: its topology is the OpenTofu module under `deploy/opentofu`, where `var.target` selects `aws`, `gcp`, or `cloudflare`. On Cloudflare the module provisions the backing D1 / KV / R2 / Queues resources. The wrangler/helm/distribute artifacts are the interim materialization of that same topology, not a separate source of truth.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at a plain OpenTofu module.
2. Run a plan and review the returned PlanRun, its planned changes, and warnings.
3. Apply the reviewed plan as an ApplyRun. A successful apply updates the Deployment and its DeploymentOutput.
4. A RunnerProfile owns the provider allowlist, credential references, state backend, and Cloudflare Container execution used by each run.
5. Account-plane policy, credentials, OIDC clients, billing, domains, and dashboards belong to the operator distribution (Takosumi Accounts).

## Release Gates

The root `CI` / `Release Gate` workflows own multi-cloud verification. OpenTofu is pinned to OpenTofu 1.12.1 for the current gate, and the required command is `bun run opentofu:plan-gate`. That gate must prove `tofu plan -refresh=false` for each supported target before a release artifact is treated as promotable.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and runner profile policy decisions. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and dashboards.

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

A PlanRun is created from this Installation, and the reviewed plan is then applied as an ApplyRun. Takos product routes should call the Takosumi deploy control plane or the Takosumi account-plane flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/installer-api)
