# Takos Product Current State

Capsule と Run の流れは [デプロイ管理の概要](/operator/) にあります。

## Current Flow

1. Register a Source for a Git URL/ref and module path for an OpenTofu Capsule repo.
2. Run a `plan` and review the resulting `plan` type Run and policy decision.
3. Run `apply` as an `apply` type Run against the reviewed plan; a successful apply updates the StateVersion and Output. Destroy uses `destroy_plan` followed by approved `destroy_apply`.
4. Repeat plan/apply against the Capsule; typed Run entries form the audit ledger for StateVersion and Output changes.
5. Connections hold credential references, ProviderBindings bind each provider (and optional alias) to an explicit provider connection (an explicit ProviderConnection), and runner policy resolves provider allowlists, state backend, and workload placement. Account-plane policy, OIDC clients, billing, and domains belong to the Takosumi Accounts plane.

## Takos Boundary

Takos と Takosumi の分担は [Takos の概念](/platform/) にあります。

## Canonical Layout

- `src/worker`: Takos Worker source owner and Hono route composition, including the fail-closed quarantine for its built-in migration-only Git Smart HTTP route. Existing repository metadata / R2 objects remain preserved pending an explicit migration, but the route does not advertise or serve clone/fetch/push. Git transport and collaborative hosting belong to an installed standalone `takos-git` Capsule.
- `web`: browser UI.
- `containers/agent`: agent execution container.
- `deploy/cloudflare` and the peer adapters under `deploy/opentofu`: product deploy artifacts. Cloudflare-specific runtime materialization stays inside the direct Cloudflare adapter.

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
    "path": "deploy/opentofu/takoform"
  }
}
```

A Capsule points at an OpenTofu Capsule repo; `plan`, `apply`, `destroy_plan`, and `destroy_apply` runs are recorded as typed Run entries. Takos product routes should call the Takosumi deploy control API or Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi model](https://takosumi.com/docs/concepts/)
- [Takosumi API リファレンス](https://takosumi.com/docs/reference/api)

## Portable Verification Boundary

`bun run check` proves repository consistency, route shape, portable behavior,
and static docs alignment. It does not prove release readiness, authorize
promotion, or prove hosted Takosumi public access; those require the Release
the deploy record and separate private operator evidence.
