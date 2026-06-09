# ランタイム / エージェント

> このページでわかること: エージェント実行とランタイムの責務分担。

Takos のランタイム実行は、エージェントサービス、Takosumi kernel、operator が
選ぶ Connection / ProviderBinding / policy、runtime-agent の責務に分かれています。
Takos product の public/control entrypoint は単一の `takos-worker` です。Cloudflare
Containers の runtime / executor host は同じ Worker script が export する Durable
Object class として配線し、別の `takos-runtime-host` / `takos-executor-host`
Worker はデプロイしません。

## 各コンポーネントの役割

| コンポーネント         | 役割                                                                                            |
| ---------------------- | ----------------------------------------------------------------------------------------------- |
| `takos-worker`         | public/control entrypoint、agent run orchestration、container dispatch、Containers host callback |
| `takos-agent` container | エージェントの実行と Takos 固有の Rust wrapper                                                  |
| Takosumi kernel        | Installation / Run / Deployment / OutputSnapshot の ledger、plan/apply/destroy run と policy decision 記録 |
| Connection/ProviderBinding/policy | Connection holds credential references; ProviderBinding resolves each provider (+ optional alias) to a default / connection / manual / disabled binding; policy resolves provider allowlists, state backend, and Cloudflare Container execution。実インフラ lifecycle は operator / runtime-agent が所有 |
| runtime-agent          | ワークロードホストのライフサイクルと実装 RPC                                                    |

Takos のコードは、Worker と containers の wire shape を `src/contracts`
経由で呼び出します。planned service 間で型を generic
な共通パッケージに複製しません。

Cloudflare profile では `src/worker/index.ts` が Hono routes と Containers DO
class (`TakosRuntimeContainer` / `ExecutorContainerTier*`) を同じ deploy unit として
export します。runtime callback は `/forward/*`、agent-control callback は
`/api/internal/v1/agent-control/*` を同一 Worker 内で受け、service binding が無い環境では
Worker adapter が in-process container host binding を合成します。

## ローカル実行

ローカル開発のサービス構成は
[ローカル開発ガイド](/get-started/local-development) を参照してください。
本番のホスティング設計は [ホスティング](/hosting/) を参照してください。
