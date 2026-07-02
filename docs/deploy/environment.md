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

| 変数                                   | 既定                        | 説明                                                                                                                                                                                                                                                                                                        |
| -------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAKOS_AGENT_TOOL_ALLOWLIST`           | `*` (bundled distribution)  | エージェントが呼べる remote tool の comma-separated allowlist。`*` で全 first-party tool (file read/write・runtime exec・web fetch・repo 操作) を許可。空にすると agent container は fail-closed で remote tool を一切実行しない。絞り込みたい場合のみ `file_read,web_fetch` のような明示リストを設定する。 |
| `TAKOS_AGENT_CONTROL_RPC_BASE_URL`     | —                           | agent container → control-plane RPC の base URL。                                                                                                                                                                                                                                                           |
| `TAKOS_AGENT_MODEL_NAME`               | catalog default (`gpt-5.5`) | agent container が OpenAI-compatible endpoint に送る実際のモデル id を上書きする。catalog の default id を自分のアカウントや Takosumi AI Gateway がまだ配信していない場合に設定する。`TAKOS_AGENT_MODEL_ENDPOINT` / `OPENAI_BASE_URL` で endpoint も上書き可能。                                            |
| `EXECUTOR_INJECT_PROVIDER_KEYS_DIRECT` | off                         | pooled container に provider key を直接注入する escape hatch。本番では off のままにする。                                                                                                                                                                                                                   |

> NOTE: `TAKOS_AGENT_TOOL_ALLOWLIST` を未設定にしても bundled distribution は worker 側で `*` を注入するため、初期 deploy でもエージェントの中核 tool が動作します。allowlist は「無効化のための fail-closed capability」であって、設定漏れで機能が死なないよう default が入ります。

## References

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
