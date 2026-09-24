# 環境変数

self-host の Takos worker が読む環境変数と、deploy adapter が受け取る変数の一覧です。
worker が読む runtime secret の値は operator が所有し、adapter は名前だけを宣言します。

## Cloudflare provider-gap bridge

直接の Cloudflare adapter は product graph を宣言しますが、provider-gap bridge は
既定で無効です。通常の install では
`cloudflare_provider_gap_bridge_mode = "off"` のままにします。使い捨ての staging
smoke では `environment = "staging"` と
`cloudflare_provider_gap_bridge_mode = "staging"` を両方設定し、1 回限りの
production 相当の E2E では `environment = "production"`、
`cloudflare_provider_gap_bridge_mode = "disposable-production"`、正確な
`cloudflare_provider_gap_bridge_acknowledgement = "DISPOSABLE_PRODUCTION_ONE_SHOT"`
を設定します。それ以外の mode / environment / acknowledgement の組み合わせは
安全側に失敗します。bridge が調整するのは自身が所有する Vectorize、Container、
container 対応 Durable Object、D1 の provider 差分だけで、D1 のデータは
巻き戻しません。

## Runtime secrets

Worker が読む 5 つの runtime secret は operator が所有します。`deploy/opentofu/cloudflare`
は名前だけを宣言し、値を保持しません。`.well-known/takosumi.json` は `takosumi.com/v2.4`
で、対称鍵 3 つを `secret.generated` (32 byte hex、binding delivery) として host に要求し、
RSA 鍵対は operator 投入のままです。値の形式と投入順序は
[ランタイムシークレット](/deploy/runtime-secrets) を参照してください。

## install の形

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

Capsule の plan が `plan` Run を始め、記録された plan の承認が `apply` Run を
始めて StateVersion と Output を更新します。Takos と Takosumi の分担は
[Takos の概念](/platform/)を参照してください。

## Worker 環境変数 (抜粋)

self-host Takos worker の `wrangler.toml` `[vars]` で設定する主な変数:

| 変数                                          | 既定                       | 説明                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAKOS_AGENT_TOOL_ALLOWLIST`                  | `*` (bundled distribution) | エージェントが呼べる remote tool の comma-separated allowlist。`*` はTakos core toolsと、現在のWorkspaceでinstalled Capsule / external MCPから動的に発見されたtoolsを許可する。空にするとagent containerは安全側に停止し、remote toolを実行しない。絞り込む場合は`web_fetch,create_artifact`や実際に公開されたMCP tool名を明示する。 |
| `TAKOS_AGENT_CONTROL_RPC_BASE_URL`            | —                          | agent container → control-plane RPC の base URL。                                                                                                                                                                                                                                                                                 |
| `TAKOS_AGENT_MAX_GRAPH_STEPS`                 | engine default (`64`)      | 1 runのgraph step上限 (`1..128`)。未設定時はWorkerが値を送らずengine defaultを使う。                                                                                                                                                                                                                                              |
| `TAKOS_AGENT_MAX_TOOL_ROUNDS`                 | engine default (`8`)       | 1 runのtool round上限 (`1..16`)。未設定時はWorkerが値を送らずengine defaultを使う。                                                                                                                                                                                                                                               |
| `TAKOS_CAPSULE_STORE_URLS`                    | `["https://store.takosumi.com"]` | agent の `store_search` が読む TCS v2 origin のJSON配列(最大4件)。各Storeは公開Git URLと表示情報だけを返し、ref/module/InstallConfig/Run authorityは持たない。空配列でremote discoveryを無効化する。                                                                                                                            |
| `OPENAI_BASE_URL`                             | OpenAI API                 | Worker-owned OpenAI-compatible endpoint。実行model idはrunのmodel catalog / allowlistで決まり、container-local overrideは持たない。                                                                                                                                                                                               |
| `TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY`       | `false`                    | self-host operator が deployment-global `OPENAI_API_KEY` を untrusted agent container へ渡す明示的な security downgrade。production default は拒否し、Takosumi AI Gateway 等が発行する短命・run-scoped credential を使う。閉じた開発環境以外では推奨しない。                                                                      |
| `TAKOS_TRUSTED_LOCAL_MCP_READONLY_SERVER_IDS` | —                          | `readOnlyHint` を信頼してside-effect dedupe対象から外してよいlocal MCP server IDのJSON配列またはcomma-separated list。未設定時は全MCP toolをside-effectingとして扱う。external MCPはここにIDを書いても緩和されない。                                                                                                              |

> NOTE: `TAKOS_AGENT_TOOL_ALLOWLIST` を未設定にしても bundled distribution は worker 側で `*` を注入するため、初期 deploy でもエージェントの中核 tool が動作します。allowlist は「無効化のための安全側に停止する capability」であって、設定漏れで機能が死なないよう default が入ります。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
