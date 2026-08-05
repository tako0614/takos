# Takos Product Current State

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Register a Source for a Git URL/ref and module path for an OpenTofu Capsule repo.
2. Run a `plan` and review the resulting `plan` type Run and policy decision.
3. Run `apply` as an `apply` type Run against the reviewed plan; a successful apply updates the StateVersion and Output. Destroy uses `destroy_plan` followed by approved `destroy_apply`.
4. Repeat plan/apply against the Capsule; typed Run entries form the audit ledger for StateVersion and Output changes.
5. Connections hold credential references, ProviderBindings bind each provider (and optional alias) to an explicit provider connection (an explicit ProviderConnection), and runner policy resolves provider allowlists, state backend, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through Capsule Outputs and Takos runtime contracts. `deploy/product-resources.json` is the provider-neutral resource authority; `deploy/opentofu` maps it to a directly connected Cloudflare account and `deploy/takoform` maps it to portable Form resources. Takosumi runs either ordinary OpenTofu module and records Capsule / Run / StateVersion / Output state, policy decisions, and audit evidence.

## Canonical Layout

- `src/worker`: Takos Worker source owner and Hono route composition, including the migration-only worker-native Git Smart HTTP endpoint (read-only clone/fetch from the R2 object store). Push and collaborative hosting belong to an installed standalone `takos-git` Capsule.
- `web`: browser UI.
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

A Capsule points at an OpenTofu Capsule repo; `plan`, `apply`, `destroy_plan`, and `destroy_apply` runs are recorded as typed Run entries. Takos product routes should call the Takosumi deploy control API or Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi model](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)

## Portable Verification Boundary

`bun run check` proves repository consistency, route shape, portable behavior,
and static docs alignment. It does not prove release readiness, authorize
promotion, or prove hosted Takosumi public access; those require the Release
the deploy record and separate private operator evidence.
