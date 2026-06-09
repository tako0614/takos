# はじめる

**Takos is self-hostable as a plain OpenTofu module; Takosumi is optional.** Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records the **Installation -> Run -> StateSnapshot -> OutputSnapshot -> Deployment** run ledger. Connections hold credential references, ProviderBindings bind each provider (plus optional alias) to `default`, `connection`, `manual`, or `disabled`, and policy resolves provider allowlists, state backend, and Cloudflare Container execution. Module metadata comes from generic repository information such as Git URL, ref, commit, and module path, plus well-known OpenTofu outputs.

## Current Flow

1. Install the Takos OpenTofu module (`deploy/opentofu`) to create an **Installation**.
2. Run a **`plan` type Run** and review the recorded plan, diff, and warnings.
3. Apply the reviewed plan as an **`apply` type Run**. A successful apply updates the **Deployment** and **OutputSnapshot**.
4. Connections hold credential references, ProviderBindings resolve each provider (plus optional alias) for the run, and policy resolves provider allowlists, state backend, and execution image / resource limits; Takosumi records the policy decision and each run in the audit ledger.
5. Account-plane policy (OIDC clients, billing, domains, dashboard) belongs to the operator distribution / Takosumi Accounts.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / Run / Deployment / OutputSnapshot) for the applied OpenTofu module, while Connections hold credential references, ProviderBindings resolve each provider (plus optional alias), and policy resolves provider allowlists and state handling. The operator distribution / Takosumi Accounts owns account-plane policy (OIDC / billing / dashboard).

## OpenTofu Module Shape

The install target is a plain OpenTofu module. Module metadata is resolved from the Git URL / ref / commit / module path and well-known OpenTofu outputs.

```hcl
module "takos" {
  source = "github.com/example/takos//deploy/opentofu"
  target = "cloudflare" # aws | gcp | cloudflare
}
```

Selecting a target moves the Installation through a typed Run until the Deployment is updated, and non-secret endpoints are recorded as OutputSnapshot. Takos product routes trust the Takosumi deploy control plane run ledger instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)

## Public Managed Offering Gate

Public managed offering gate status is checked from `takos-private` with
`managed-offering:status`. Public signup stays `closed` until that read-only
status reports `canOpenManagedOffering: true`; install links should use
`https://<OPERATOR_INSTALL_HOST>/install?...` rather than a fixed production
host while the gate is closed.
