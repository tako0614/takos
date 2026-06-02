# Takos Product Current State

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records each `plan` as a **PlanRun** and each `apply`/`destroy` as an **ApplyRun**. A successful apply updates the **Deployment** and its **DeploymentOutput**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Point an Installation at a Git URL/ref and module path for a plain OpenTofu module repo.
2. Run a `plan` and review the resulting PlanRun and runner profile policy decision.
3. Run `apply` (or `destroy`) as an ApplyRun against the reviewed plan; a successful apply updates the Deployment and DeploymentOutput.
4. Repeat plan/apply against the Installation; PlanRun and ApplyRun entries form the audit ledger for that Deployment.
5. The RunnerProfile owns the provider allowlist, credential references, state backend, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos itself is deployed by Takosumi as an installed-and-applied OpenTofu module (`deploy/opentofu`, with `var.target` in `aws` | `gcp` | `cloudflare`; the `cloudflare` target provisions D1 / KV / R2 / Queues backing resources). Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and dashboard.

## Canonical Layout

- `src/worker`: Takos Worker source owner and Hono route composition.
- `web`: browser UI.
- `containers/git`: Git hosting container.
- `containers/agent`: agent execution container.
- `deploy/opentofu`, `deploy/helm`, and `deploy/distributions`: product distribution artifacts.

## Takosumi Service Boundary

Takosumi implementation detail stays inside `../takosumi/src/service`. Its
internal domains include `src/service/domains/deploy` and
`src/service/domains/runtime`; those are domain modules inside the Takosumi
service, not standalone Takos product services.

Backend adapter and runtime-agent handler work belongs to the operator
distribution that owns the OpenTofu / Helm / native controller stack. Takos
keeps only its own product distribution artifacts (the `deploy/opentofu`
module and related topology).

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "url": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu"
  }
}
```

An Installation points at a plain OpenTofu module repo; `plan` and `apply` runs are recorded as PlanRun and ApplyRun entries. Takos product routes should call the Takosumi deploy control API or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/takosumi-v1)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)

## Current Exit Criteria

The local / CI-equivalent exit criteria prove repository consistency, route
shape, and static docs alignment. They do not prove the public managed offering;
that requires private operator evidence and the managed offering live audit.
