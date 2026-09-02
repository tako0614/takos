# 環境変数

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Create a Capsule from a Git URL/ref pointing at a OpenTofu Capsule.
2. Start a `plan` type Run and review the recorded plan, changes, warnings, and policy decision.
3. Approve the reviewed plan to start an `apply` type Run. A successful apply updates the StateVersion and Output.
4. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, domains, and account-plane policy belong to the Takosumi Accounts plane.

## Cloudflare provider-gap bridge

The direct Cloudflare adapter declares the product graph, while the provider-gap bridge remains disabled by default. Keep
`cloudflare_provider_gap_bridge_mode = "off"` for ordinary installs. A disposable staging smoke run must set both
`environment = "staging"` and `cloudflare_provider_gap_bridge_mode = "staging"`; a one-shot production-equivalent E2E must set
`environment = "production"`, `cloudflare_provider_gap_bridge_mode = "disposable-production"`, and the exact
`cloudflare_provider_gap_bridge_acknowledgement = "DISPOSABLE_PRODUCTION_ONE_SHOT"`. Any other mode/environment or acknowledgement
combination fails closed. The bridge only reconciles its owned Vectorize, Container, container-enabled Durable Object, and D1
provider gaps; it never rolls back D1 data.

## Runtime secrets

Worker が読む 5 つの runtime secret は operator が所有します。`deploy/opentofu/cloudflare`
は名前だけを宣言し、値を保持しません。`.well-known/takosumi.json` は `takosumi.com/v2.4`
で、対称鍵 3 つを `secret.generated` (32 byte hex、binding delivery) として host に要求し、
RSA 鍵対は operator 投入のままです。値の形式と投入順序は
[ランタイムシークレット](/deploy/runtime-secrets) を参照してください。

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through Capsule Outputs and Takos runtime contracts. `deploy/product-resources.json` is the provider-neutral resource authority; `deploy/opentofu/cloudflare` is the current product-graph adapter. Cloudflare provider gaps remain explicit unless the reviewed bridge is selected for a disposable E2E. Takosumi runs it as an ordinary OpenTofu module and records Capsule / Run / StateVersion / Output state, policy decisions, and audit evidence. The former Provider 1.x Takoform projection is not a current install surface.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "deploy/opentofu/cloudflare"
  }
}
```

A Capsule plan starts a `plan` type Run; approving the recorded plan starts an `apply` type Run that updates the StateVersion and Output. Takos product routes should call the Takosumi deploy control API or the Takosumi account-plane install flow instead of exposing a separate product-local deployment surface.

## Worker 環境変数 (抜粋)

self-host Takos worker の `wrangler.toml` `[vars]` で設定する主な変数:

| 変数                                          | 既定                       | 説明                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAKOS_AGENT_TOOL_ALLOWLIST`                  | `*` (bundled distribution) | エージェントが呼べる remote tool の comma-separated allowlist。`*` はTakos core toolsと、現在のWorkspaceでinstalled Capsule / external MCPから動的に発見されたtoolsを許可する。空にするとagent containerはfail-closedでremote toolを実行しない。絞り込む場合は`web_fetch,create_artifact`や実際に公開されたMCP tool名を明示する。 |
| `TAKOS_AGENT_CONTROL_RPC_BASE_URL`            | —                          | agent container → control-plane RPC の base URL。                                                                                                                                                                                                                                                                                 |
| `TAKOS_AGENT_MAX_GRAPH_STEPS`                 | engine default (`64`)      | 1 runのgraph step上限 (`1..128`)。未設定時はWorkerが値を送らずengine defaultを使う。                                                                                                                                                                                                                                              |
| `TAKOS_AGENT_MAX_TOOL_ROUNDS`                 | engine default (`8`)       | 1 runのtool round上限 (`1..16`)。未設定時はWorkerが値を送らずengine defaultを使う。                                                                                                                                                                                                                                               |
| `TAKOS_CAPSULE_STORE_URLS`                    | `["https://store.takosumi.com"]` | agent の `store_search` が読む TCS v2 origin のJSON配列(最大4件)。各Storeは公開Git URLと表示情報だけを返し、ref/module/InstallConfig/Run authorityは持たない。空配列でremote discoveryを無効化する。                                                                                                                            |
| `OPENAI_BASE_URL`                             | OpenAI API                 | Worker-owned OpenAI-compatible endpoint。実行model idはrunのmodel catalog / allowlistで決まり、container-local overrideは持たない。                                                                                                                                                                                               |
| `TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY`       | `false`                    | self-host operator が deployment-global `OPENAI_API_KEY` を untrusted agent container へ渡す明示的な security downgrade。production default は拒否し、Takosumi AI Gateway 等が発行する短命・run-scoped credential を使う。閉じた開発環境以外では推奨しない。                                                                      |
| `TAKOS_TRUSTED_LOCAL_MCP_READONLY_SERVER_IDS` | —                          | `readOnlyHint` を信頼してside-effect dedupe対象から外してよいlocal MCP server IDのJSON配列またはcomma-separated list。未設定時は全MCP toolをside-effectingとして扱う。external MCPはここにIDを書いても緩和されない。                                                                                                              |

> NOTE: `TAKOS_AGENT_TOOL_ALLOWLIST` を未設定にしても bundled distribution は worker 側で `*` を注入するため、初期 deploy でもエージェントの中核 tool が動作します。allowlist は「無効化のための fail-closed capability」であって、設定漏れで機能が死なないよう default が入ります。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
