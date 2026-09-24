# API リファレンス

**Premise: Takos は provider-neutral な resource contract を持つ OpenTofu-native AI workspace distribution です。**
`deploy/opentofu/cloudflare` は、その contract の product graph を直接接続した Cloudflare account へ写すcurrent adapterです。Cloudflare provider がまだ表現できない gap は通常の production provider path では解決されず、bridge は既定で off です。source graph の gap まで反映する disposable E2E では、`environment` と一致する reviewed bridge mode を明示します。Takosumi はmoduleを通常の Capsule として扱い、
OpenTofu-native な deploy control plane として run ledger
**Capsule -> Run -> StateVersion -> Output** を記録します。Connection が credential reference を保持し、
ProviderBinding が provider (+ optional alias) ごとに explicit provider connection (an explicit ProviderConnection) を解決し、policy が provider allowlist / state backend / workload placement を解決します。

## 現在の流れ

1. Takos の OpenTofu module (`deploy/opentofu/cloudflare`) を指す
   **Capsule** を作ります。module metadata は Git URL / commit / tag / module path と well-known OpenTofu outputs から解決します。
2. `plan` を実行すると **`plan` type Run** が記録され、reviewed plan として diff / warning / policy decision を確認できます。
3. reviewed plan を `apply` すると **`apply` type Run** が記録され、成功した apply が StateVersion と Output を更新します。
4. apply が公開した non-secret service URL / binding map は **Output** として記録されます。
5. Connection が credential reference を保持し、ProviderBinding が provider (+ optional alias) ごとに explicit provider connection を解決し、policy が provider allowlist / state backend / workload placement を解決し、
   account / billing / OIDC / dashboard は Takosumi Accounts plane が所有します。

## Takos と Takosumi の境界

Takos が持つのは product UI、chat、agent、memory、Workspace、アプリ起動の UX です。
Git、ストレージ、agent runtime、file handler、UI、MCP は product-local の
service class ではなく、Capsule の Output と Takos の runtime contract 経由で
公開されます。Takosumi は Capsule / Run / StateVersion / Output と監査の履歴を
記録します。接続 (credential) は ProviderConnection が参照を持ち、
ProviderBinding が provider (と任意の alias) ごとに接続を解決し、policy が
provider の許可リスト、state の扱い、runner の実行を解決します。アカウントの
policy (アカウント / 課金 / OIDC / dashboard) は Takosumi Accounts plane が
所有します。詳しくは [Takos の概念](/platform/)を参照してください。

## Current Boundary (現在の境界)

Takos の product route は workspace、thread、run、tool、アプリ起動の API を
公開します。下記の Capsule 一覧と lifecycle の route は、外部の Takosumi
control plane への認証済みの投影であり、Takos は第二の service、Resource、
Deployment の lifecycle を保持も実行もしません。Takosumi Accounts は
account-plane の identity、アカウント / 課金の policy、OIDC issuer の動作、
dashboard を介した install flow を所有します。

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
`takosumi-private/platform/wrangler.toml` と operator-local secrets などの手作業で維持する deploy 用の生成物は
同じ topology の **interim materialization** (暫定的な実体化) であり、別の正とする情報として扱いません。Takos product routes は独自の
product-local deployment surface を公開せず、Takosumi の deploy control API 経由で plan / apply / destroy を行います。

GitHub Release と Cloudflare Container Registry へ versioned distribution bytes を公開する
`takos-release-artifact` は product deployment ではありません。これは Takosumi が
digest 固定して取得する入力を一度だけ発行する surface であり、Workspace、Capsule、
provider credential、plan、apply、destroy の authority は持ちません。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Internal trust boundaries](/architecture/internal-trust-boundaries)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
