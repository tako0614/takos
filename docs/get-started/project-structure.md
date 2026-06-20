# プロジェクト構成

Takos は AI workspace distribution です。ユーザー向けの主な構成要素は Workspace、chat、agent、memory、Git、
app launcher、MCP tools です。アプリや追加 runtime service は Git URL から入る OpenTofu Capsule として install され、
embedded Takosumi services が Installation / Run / Deployment / OutputSnapshot / Service Graph を管理します。

## Current Flow

1. Create a Workspace and use the seeded first-party apps, chat, memory, Git, and tools.
2. Install more apps or services by selecting a Git URL/ref and module path for an OpenTofu Capsule.
3. Review the Takosumi `plan` Run and approve the saved plan before `apply`.
4. Takos reads non-secret outputs and Service Graph records to show app launcher entries, MCP tools, file handlers, storage, Git, and agent runtime capabilities.
5. Accounts, billing, OIDC clients, dashboard, provider credentials, state, and audit evidence stay in embedded Takosumi services.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Takosumi Service Graph as ServiceExport, ServiceBinding, and ServiceGrant records. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions D1/KV/R2/Queues backing resources, while embedded Takosumi services record Installation / Run / StateSnapshot / OutputSnapshot / Deployment state, policy decisions, and audit trail.

## Installation Shape

An Installation references the OpenTofu module to deploy:

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "path": "deploy/opentofu"
  }
}
```

Plan and apply requests reference the Installation and the reviewed `plan` type Run. Takos product routes call the Takosumi deploy-control API or the Takosumi Accounts dashboard flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
