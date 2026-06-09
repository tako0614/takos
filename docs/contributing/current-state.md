# Takos Product Current State

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module repo as an **Installation** and records each `plan` as a **`plan` type Run** and each `apply`/`destroy` as an **`apply` type Run**. A successful apply updates the **Deployment** and its **OutputSnapshot**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Point an Installation at a Git URL/ref and module path for a plain OpenTofu module repo.
2. Run a `plan` and review the resulting `plan` type Run and policy decision.
3. Run `apply` (or `destroy`) as an `apply` type Run against the reviewed plan; a successful apply updates the Deployment and OutputSnapshot.
4. Repeat plan/apply against the Installation; typed Run entries form the audit ledger for that Deployment.
5. Connections hold credential references, ProviderBindings bind each provider (and optional alias) to a default / connection / manual / disabled resolution, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. Account-plane policy, OIDC clients, billing, and domains belong to the in-process Accounts plane in the single Takos worker.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takos can optionally be installed through Takosumi as a normal OpenTofu module (`deploy/opentofu`, Cloudflare module; it provisions D1 / KV / R2 / Queues backing resources). Takosumi records Installation / Run / StateSnapshot / OutputSnapshot / Deployment state. In self-host deployments, the deploy-control plane and Accounts plane run in-process inside the single Takos worker at the self-hoster's own origin; `app.takosumi.com` is only the operator Takosumi platform worker. Their implementation is owned by the Takosumi service repo and imported via tsconfig alias.

## Canonical Layout

- `src/worker`: Takos Worker source owner and Hono route composition.
- `web`: browser UI.
- `containers/git`: Git hosting container.
- `containers/agent`: agent execution container.
- `deploy/cloudflare`, `deploy/opentofu` (Cloudflare module), and `deploy/distributions/cloudflare.json`: product deploy artifacts.

## Takosumi Service Boundary

Takosumi implementation detail stays inside `../takosumi/src/service`, and is
the source owner imported in-process by the single Takos worker via tsconfig
alias. Its internal domains include `src/service/domains/deploy-control`,
`src/service/domains/deploy-records`, and `src/service/domains/runtime`; those
are domain modules inside the Takosumi service code, not standalone Takos
product services.

Backend adapter and runtime-agent handler work stays in that Takosumi service
code; Takos keeps only its own Cloudflare deploy artifacts (the
`deploy/cloudflare` worker bootstrap, the `deploy/opentofu` Cloudflare module,
and `deploy/distributions/cloudflare.json`).

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

An Installation points at a plain OpenTofu module repo; `plan` and `apply` runs are recorded as typed Run entries. Takos product routes should call the Takosumi deploy control API or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/takosumi-v1)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)

## Current Exit Criteria

The local / CI-equivalent exit criteria prove repository consistency, route
shape, and static docs alignment. They do not prove the public managed offering;
that requires private operator evidence and the managed offering live audit.
