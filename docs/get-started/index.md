# はじめる

**Takos is a product that runs on Takosumi and is deployed by it.** Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records the **Installation → PlanRun → ApplyRun → Deployment → DeploymentOutput** run ledger. Provider allowlist, credentials, state backend, and Cloudflare Container execution are owned by a **RunnerProfile**. Module metadata comes from generic repository information such as Git URL, ref, commit, and module path, plus well-known OpenTofu outputs.

## Current Flow

1. Install the Takos OpenTofu module (`deploy/opentofu`) to create an **Installation**.
2. Run a **PlanRun** and review the recorded plan, diff, and warnings.
3. Apply the reviewed plan as an **ApplyRun**. A successful apply updates the **Deployment** and **DeploymentOutput**.
4. The **RunnerProfile** owns the provider allowlist, credential reference, state backend, and execution image / resource limits; Takosumi records the RunnerProfile policy decision and each run in the audit ledger.
5. Account-plane policy (OIDC clients, billing, domains, dashboard) belongs to the operator distribution / Takosumi Accounts.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records the run ledger (Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput) for the applied OpenTofu module, while the RunnerProfile owns the provider allowlist, credentials, and state backend. The operator distribution / Takosumi Accounts owns account-plane policy (OIDC / billing / dashboard).

## OpenTofu Module Shape

The install target is a plain OpenTofu module; Takosumi does not require a Takosumi-specific manifest or `.takosumi.*` file. Module metadata is resolved from the Git URL / ref / commit / module path and well-known OpenTofu outputs.

```hcl
module "takos" {
  source = "github.com/example/takos//deploy/opentofu"
  target = "cloudflare" # aws | gcp | cloudflare
}
```

Selecting a target moves the Installation through a PlanRun and ApplyRun until the Deployment is updated, and non-secret endpoints are recorded as DeploymentOutput. Takos product routes trust the Takosumi deploy control plane run ledger instead of exposing a separate deployment proxy.

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
