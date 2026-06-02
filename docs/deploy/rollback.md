# ロールバック

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module and records an **Installation**, then **PlanRun** / **ApplyRun** entries, with each successful apply updating the **Deployment** and its **DeploymentOutput**. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, and module path.

## Current Flow

1. Create an Installation from a Git URL/ref pointing at the OpenTofu module.
2. Trigger a PlanRun and review its plan summary, diff, and policy decision.
3. Approve the reviewed plan to start an ApplyRun; a successful ApplyRun updates the Deployment and its DeploymentOutput.
4. A RunnerProfile owns the provider allowlist, credential references, state backend, and Cloudflare Container execution used by each PlanRun / ApplyRun.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, and domains belong to the operator distribution; Takosumi records the run ledger and audit trail.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and the audit trail. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and the dashboard.

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

A PlanRun is reviewed before its plan is approved into an ApplyRun. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate deployment proxy.

provider data copy / schema migration の巻き戻しは rollback の current guarantee ではありません。Rollback は Installation の
current Deployment pointer を retained successful Deployment に戻す control-plane 操作です。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/takosumi-v1)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
