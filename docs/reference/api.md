# API リファレンス

**Premise: Takos は provider-neutral な resource contract を持つ OpenTofu-native AI workspace distribution です。**
`deploy/opentofu/takoform` と `deploy/opentofu/cloudflare` は、その同じ contract をそれぞれ portable Form host と直接接続した Cloudflare account へ写す sibling adapter です。Takosumi は選択された module を通常の Capsule として扱い、
OpenTofu-native な deploy control plane として run ledger
**Capsule -> Run -> StateVersion -> Output** を記録します。Connection が credential reference を保持し、
ProviderBinding が provider (+ optional alias) ごとに explicit provider connection (an explicit ProviderConnection) を解決し、policy が provider allowlist / state backend / workload placement を解決します。

## Current Flow

1. Takos の OpenTofu module (`deploy/opentofu/takoform` または `deploy/opentofu/cloudflare`) を指す
   **Capsule** を作る。module metadata は Git URL / commit / tag / module path と well-known OpenTofu outputs から解決する。
2. `plan` を実行すると **`plan` type Run** が記録され、reviewed plan として diff / warning / policy decision を確認する。
3. reviewed plan を `apply` すると **`apply` type Run** が記録され、成功した apply が StateVersion と Output を更新する。
4. apply が公開した non-secret service URL / binding map は **Output** として記録される。
5. Connection が credential reference を保持し、ProviderBinding が provider (+ optional alias) ごとに explicit provider connection を解決し、policy が provider allowlist / state backend / workload placement を解決し、
   account / billing / OIDC / dashboard は Takosumi Accounts plane が所有する。

## Takos Boundary

Takos owns product UI, chat, agent, memory, Workspaces, and app launcher UX. Git, storage, agent runtime,
file handlers, UI surfaces, and MCP are exposed through Capsule Outputs and Takos runtime contracts rather than product-local service classes。Takosumi records Capsule / Run / StateVersion / Output と audit ledger。Connections hold credential references, ProviderBindings resolve each
provider (and optional alias), and policy resolves provider allowlists, state handling, and runner execution。
account-plane policy (account / billing / OIDC / dashboard) は Takosumi Accounts plane が所有する。

## Current Boundary

Takos product routes expose workspace, thread, run, tools, and app-launcher
APIs. Capsule inventory and lifecycle routes below are authenticated projections
to the external Takosumi control plane; Takos does not persist or execute a
second service, Resource, or Deployment lifecycle. Takosumi Accounts owns
account-plane identity, account/billing policy, OIDC issuer behavior, and the
dashboard-backed installation flow.

## Capsule API

Current public/product API markers:

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
- `/api/spaces/:spaceId/capsules`
- `/api/spaces/:spaceId/capsules/:capsuleId/services`
- `/api/spaces/:spaceId/capsules/git-url/plan`
- `/api/spaces/:spaceId/capsules/git-url/apply`
- `/api/spaces/:spaceId/capsules/git-url/revision/plan`
- `/api/spaces/:spaceId/capsules/git-url/revision/apply`
- `/api/spaces/:spaceId/capsules/:capsuleId` (`DELETE` は destroy-plan Run の作成だけを行い、
  `202` とレビュー用 Run / expected guard を返す。適用は Takosumi 側の承認後に行う)
- `/_takosumi/launch`
- `/git/:owner/:repo.git/info/refs`

Git URL の `plan` は呼び出し側が `Idempotency-Key` header を必ず送り、通信再試行でも
同じ install 操作キーを使います。Capsule HTTP は delegated Accounts Workspace のみを
受け付け、deployment-wide operator token へはフォールバックしません。
upgrade の `revision/plan` も同じ規則で、Takos は Git ref だけを Takosumi の耐久
revision coordinator へ渡します。Source の書換え、同期、Capsule plan は Takosumi が
所有し、Takos は reviewable Run を受け取ってから別の `revision/apply` を呼びます。
rollback は既存 StateVersion の rollback-plan を使います。

`/git/:owner/:repo.git/*` は既存 repository の clone / fetch 用 read-only
compatibility endpoint です。`git-receive-pack` は拒否されます。repository writes、
pull request、review、release などの collaborative hosting API は Takos Worker に
mount せず、installed `takos-git` の `source.git.smart_http` /
`source.git.hosting` Interface を利用します。

## Deploy authority

Takos の deploy 権威は Takosumi-applied OpenTofu Capsule です。
`takosumi-private/platform/wrangler.toml` と operator-local secrets などの hand-maintained deploy materialization は
同じ topology の **interim materialization** であり、別の source of truth として扱わない。Takos product routes は独自の
product-local deployment surface を expose せず、Takosumi の deploy control API 経由で plan / apply / destroy を行う。

GitHub Release と Cloudflare Container Registry へ versioned distribution bytes を公開する
`takos-release-artifact` は product deployment ではありません。これは Takosumi が
digest 固定して取得する入力を一度だけ発行する surface であり、Workspace、Capsule、
provider credential、plan、apply、destroy の authority は持ちません。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](/architecture/internal-trust-boundaries)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
