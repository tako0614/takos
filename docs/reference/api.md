# API リファレンス

**Premise: Takos は OpenTofu-native, Takosumi-managed な first-party AI workspace distribution です。** 基本の deploy topology は
`deploy/opentofu` の OpenTofu Capsule と wrangler artifact step です。Takosumi は Takos distribution を Capsule として扱い、
OpenTofu-native な deploy control plane として run ledger
**Capsule -> Run -> StateVersion -> Output** を記録します。Connection が credential reference を保持し、
ProviderBinding が provider (+ optional alias) ごとに explicit provider connection (an explicit ProviderConnection) を解決し、policy が provider allowlist / state backend / Cloudflare Container execution を解決します。

## Current Flow

1. Takos の OpenTofu module (`deploy/opentofu`、`var.target = cloudflare`) を指す
   **Capsule** を作る。module metadata は Git URL / commit / tag / module path と well-known OpenTofu outputs から解決する。
2. `plan` を実行すると **`plan` type Run** が記録され、reviewed plan として diff / warning / policy decision を確認する。
3. reviewed plan を `apply` すると **`apply` type Run** が記録され、成功した apply が StateVersion と Output を更新する。
4. apply が公開した non-secret service URL / binding map は **Output** として記録される。
5. Connection が credential reference を保持し、ProviderBinding が provider (+ optional alias) ごとに explicit provider connection を解決し、policy が provider allowlist / state backend / Cloudflare Container execution を解決し、
   account / billing / OIDC / dashboard は Takosumi Accounts plane が所有する。

## Takos Boundary

Takos owns product UI, chat, agent, memory, Workspaces, and bundled app launcher UX. Git, storage, agent runtime,
file handlers, UI surfaces, and MCP are exposed through Capsule Outputs and Takos runtime contracts rather than product-local service classes。Takosumi records Capsule / Run / StateVersion / Output と audit ledger。Connections hold credential references, ProviderBindings resolve each
provider (and optional alias), and policy resolves provider allowlists, state handling, and runner execution。
account-plane policy (account / billing / OIDC / dashboard) は Takosumi Accounts plane が所有する。

## Current Boundary

Takos product routes expose workspace, thread, run, tools, resource, app-installation, and workspace service APIs. Takosumi Accounts
owns account-plane identity, account/billing policy, OIDC issuer behavior, and dashboard-backed installation flow. Takos
product routes should call the external Takosumi Accounts / deploy-control APIs instead of creating a separate
product-local deployment surface.

## Capsule API

Current public/product API markers:

- `/api/public/v1/deployments`
- `/api/spaces/:spaceId/threads/search`
- `/api/threads/:threadId/runs`
- `/api/threads/:threadId/messages/search`
- `/api/threads/:threadId/shares/:shareId/revoke`
- `/api/runs/:id/events`
- `/api/runs/:id/replay`
- `/api/runs/:id/ws`
- `/api/runs/:id/artifacts`
- `/api/artifacts/:id`
- `/api/spaces/:spaceId/tools`
- `/api/spaces/:spaceId/tools/:toolName`
- `/api/explore/catalog`
- `/api/explore/repos/by-name/:username/:repoName`
- `/api/explore/packages/by-repo/:repoId/reviews`
- `/api/repositories/:repoId/commits/:commitSha`
- `/api/services/*`
- `/api/spaces/:spaceId/resources/*`
- `/api/spaces/:spaceId/app-installations`
- `/api/spaces/:spaceId/app-installations/git-url/dry-run`
- `/_takosumi/launch`
- `/git/:owner/:repo.git/info/refs`

## Deploy authority

Takos の deploy 権威は Takosumi-applied OpenTofu Capsule です。
`takosumi-private/platform/wrangler.toml` と operator-local secrets などの hand-maintained deploy materialization は
同じ topology の **interim materialization** であり、別の source of truth として扱わない。Takos product routes は独自の
product-local deployment surface を expose せず、Takosumi の deploy control API 経由で plan / apply / destroy を行う。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](/architecture/internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
