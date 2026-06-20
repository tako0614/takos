# Takos Product Current State

Takosumi v1 uses OpenTofu Capsules. Takosumi is an OpenTofu-native deploy control plane: it installs an OpenTofu Capsule repo as an **Installation** and records `plan`, `apply`, `destroy_plan`, and `destroy_apply` as distinct typed Runs. A successful apply updates the **Deployment** and its **OutputSnapshot**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Point an Installation at a Git URL/ref and module path for an OpenTofu Capsule repo.
2. Run a `plan` and review the resulting `plan` type Run and policy decision.
3. Run `apply` as an `apply` type Run against the reviewed plan; a successful apply updates the Deployment and OutputSnapshot. Destroy uses `destroy_plan` followed by approved `destroy_apply`.
4. Repeat plan/apply against the Installation; typed Run entries form the audit ledger for that Deployment.
5. Connections hold credential references, Installation provider connections bind each provider (and optional alias) to an explicit provider connection (`own_key` or `takos_provided`), and runner policy resolves provider allowlists, state backend, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, and domains belong to the in-process Accounts plane in the single Takos worker.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions D1/KV/R2/Queues backing resources, while embedded Takosumi services record Installation / Run / StateSnapshot / OutputSnapshot / Deployment state, policy decisions, and audit trail.

## Canonical Layout

- `src/worker`: Takos Worker source owner and Hono route composition.
- `web`: browser UI.
- `containers/git`: Git hosting container.
- `containers/agent`: agent execution container.
- `deploy/cloudflare`, `deploy/opentofu` (Cloudflare module), and `deploy/distributions/cloudflare.json`: product deploy artifacts.

## Takosumi Service Boundary

Takosumi implementation detail stays inside `../takosumi/core`,
`../takosumi/accounts`, `../takosumi/worker`, `../takosumi/providers`, and
`../takosumi/lib`, and is imported in-process by the single Takos worker via
tsconfig aliases. Those are Takosumi source modules, not standalone Takos
product services.

Takosumi internal domain modules live under `../takosumi/core/domains`,
including `domains/deploy-control` and `domains/runtime`; Takos docs reference
them only as Takosumi-owned implementation boundaries.

Backend adapter, provider resolver, runner, and account-plane handler work stays
in Takosumi-owned source. Takos keeps its own product shell, web UI, containers,
and Cloudflare distribution artifacts.

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

An Installation points at an OpenTofu Capsule repo; `plan`, `apply`, `destroy_plan`, and `destroy_apply` runs are recorded as typed Run entries. Takos product routes should call the Takosumi deploy control API or Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi model](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)

## Current Exit Criteria

The local / CI-equivalent exit criteria prove repository consistency, route
shape, and static docs alignment. They do not prove hosted Takosumi public
access; that requires private operator evidence and the platform access live
audit.
