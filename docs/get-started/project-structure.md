# プロジェクト構成

Takos は AI workspace distribution です。ユーザー向けの主な構成要素は Workspace、chat、agent、memory、Git、
app launcher、MCP tools です。アプリや追加 runtime service は Git URL から入る OpenTofu Capsule として install され、
external Takosumi control plane が Capsule / Run / StateVersion / Output / Capsule output projection を管理します。

## Current Flow

1. Create a Workspace and use chat, memory, Git, and tools.
2. Install apps or services by selecting a Git URL/ref and module path for an OpenTofu Capsule.
3. Review the Takosumi `plan` Run and approve the saved plan before `apply`.
4. Takos reads non-secret outputs and Capsule output projection records to show app launcher entries, MCP tools, file handlers, storage, Git, and agent runtime capabilities.
5. Accounts, billing, OIDC clients, dashboard, provider credentials, state, and audit evidence stay in external Takosumi control plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions Takos product D1/KV/R2/Queues backing resources, while an external Takosumi control plane records Capsule / Run / StateVersion / Output state, policy decisions, and audit trail.

## Capsule Shape

A Capsule references the OpenTofu module to deploy:

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

Plan and apply requests reference the Capsule and the reviewed `plan` Run. Takos product routes call the Takosumi deploy-control API or the Takosumi Accounts dashboard flow instead of exposing a separate product-local deployment surface.

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
