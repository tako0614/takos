# takos-slide

This page has been reset for Takosumi v1. Takosumi is an OpenTofu-native deploy control plane: it installs a plain OpenTofu module from a Git repository and records an **Installation**, then a **PlanRun** and **ApplyRun** per run, with successful applies updating **Deployment** and **DeploymentOutput**. Repository metadata comes from generic information such as Git URL, ref, commit, tag, and well-known OpenTofu outputs.

## Current Flow

1. Choose a Git URL/ref for the app's OpenTofu module.
2. Create an Installation and run a **PlanRun**; review the resolved commit, requested bindings, plan diff, and warnings.
3. Approve the reviewed plan to trigger an **ApplyRun**; a successful apply updates **Deployment** and **DeploymentOutput**.
4. A **RunnerProfile** owns the provider allowlist, credential references, state backend, and Cloudflare Container execution for each run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, and domains belong to the operator distribution.

## Takos Boundary

Takos owns product UI, chat, agent, memory, spaces, Git hosting, bundled app launcher metadata, file-handler metadata, and MCP-facing product metadata. Takosumi records Installation / PlanRun / ApplyRun / Deployment / DeploymentOutput state and runner profile policy decisions. Takosumi or another operator distribution owns account-plane policy, billing, OIDC, and dashboard.

## Install Input Shape

```json
{
  "spaceId": "space_1",
  "git": {
    "url": "https://github.com/example/app.git",
    "ref": "v1.2.3"
  }
}
```

Takosumi resolves the requested ref to an immutable commit at PlanRun time, and the ApplyRun applies the reviewed commit. Takos product routes should call the Takosumi deploy control plane or Takosumi account-plane install flow instead of exposing a separate deployment proxy.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/core-spec)
- [Takosumi deploy control plane](https://takosumi.com/docs/reference/core-spec)
