# 環境変数

Takosumi runs plain OpenTofu Capsules. It registers a Git Source, creates a Capsule, records plan/apply/destroy Runs, and captures StateVersion / Output evidence. Module metadata comes from generic repository information such as Git URL, ref, commit, tag, module path, and well-known OpenTofu outputs.

## Current Flow

1. Create a Capsule from a Git URL/ref pointing at a OpenTofu Capsule.
2. Start a `plan` type Run and review the recorded plan, changes, warnings, and policy decision.
3. Approve the reviewed plan to start an `apply` type Run. A successful apply updates the StateVersion and Output.
4. Connections hold credential references, ProviderBindings resolve each provider (+ optional alias) to an explicit provider connection, and policy resolves provider allowlists, state backend, and Cloudflare Container execution for each run.
5. Infrastructure lifecycle, credentials, OIDC clients, billing, domains, and account-plane policy belong to the Takosumi Accounts plane.

## Takos Boundary

Takos owns the user-facing workspace experience: chat, agents, memory, Workspaces, and app launcher. Git, storage, agent runtime, file handlers, UI surfaces, and MCP are exposed through the Capsule Outputs and Takos runtime contracts. Takos is delivered as an OpenTofu-native, Takosumi-managed distribution: `deploy/opentofu` (`var.target = cloudflare`) provisions Takos product D1/KV/R2/Queues backing resources, while an external Takosumi control plane records Capsule / Run / StateVersion / Output state, policy decisions, and audit trail.

## API Shape

```json
{
  "spaceId": "space_1",
  "module": {
    "gitUrl": "https://github.com/example/app.git",
    "ref": "main",
    "modulePath": "deploy/opentofu"
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
| `OPENAI_BASE_URL`                             | OpenAI API                 | Worker-owned OpenAI-compatible endpoint。実行model idはrunのmodel catalog / allowlistで決まり、container-local overrideは持たない。                                                                                                                                                                                               |
| `TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY`       | `false`                    | self-host operator が deployment-global `OPENAI_API_KEY` を untrusted agent container へ渡す明示的な security downgrade。production default は拒否し、Takosumi AI Gateway 等が発行する短命・run-scoped credential を使う。閉じた開発環境以外では推奨しない。                                                                      |
| `TAKOS_TRUSTED_LOCAL_MCP_READONLY_SERVER_IDS` | —                          | `readOnlyHint` を信頼してside-effect dedupe対象から外してよいlocal MCP server IDのJSON配列またはcomma-separated list。未設定時は全MCP toolをside-effectingとして扱う。external MCPはここにIDを書いても緩和されない。                                                                                                              |

> NOTE: `TAKOS_AGENT_TOOL_ALLOWLIST` を未設定にしても bundled distribution は worker 側で `*` を注入するため、初期 deploy でもエージェントの中核 tool が動作します。allowlist は「無効化のための fail-closed capability」であって、設定漏れで機能が死なないよう default が入ります。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
