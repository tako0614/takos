# ランタイム / エージェント

> このページでわかること: Takos の chat agent Run、実行 container、tool / memory の責務分担。

Takos の chat agent Run は Takos product の entity です。Thread、message、agent Run、memory、skill、tool
authorization の正本 (正とする情報) は `takos-worker` が持ちます。Takosumi の OpenTofu `Run` は Capsule /
infrastructure の plan / apply / destroy を記録する ledger (履歴) であり、chat agent Run とは別物です。
Takosumi は agent container を含む Capsule の生成を管理できますが、agent の会話の第二の control plane には
なりません。

Takos product の public / control entrypoint は単一の `takos-worker` です。Cloudflare Containers の executor
host は同じ Worker script が export する Durable Object class として配線し、別の `takos-runtime-host` /
`takos-executor-host` Worker はデプロイしません。

## 実行モデル

Takos は Cloudflare Agents SDK の責務分離を参考にしますが、SDK 自体を product contract にはしません。

| 責務 | Takos の正本 | Cloudflare へ直接置く場合の adapter |
| --- | --- | --- |
| Agent の identity、Thread、message、状態 | `takos-worker` と product DB / StatefulEntity | Worker と Durable Object |
| 長時間・再試行可能な Run | Queue、lease、checkpoint、operation ledger | Queue と Container host。将来 Workflows を使う実装も adapter として追加可能 |
| model / tool loop | `takos-agent` ContainerService | Cloudflare Container |
| tool の発見 / 接続 | Workspace の MCP と installed Capsule Interface | Worker binding / service binding への projection |
| shell、browser、desktop、Git Actions | Takos core の外。install した app または外部 runtime | `takos-computer`、`takos-git` など |

lease、checkpoint、operation ledger、fence などの実行を支える用語は[用語集](/reference/glossary)で説明しています。

この分離により、Cloudflare Agents SDK の永続化する agent、streaming、MCP、Workflow 連携と同じ設計上の利点を
保ちながら、Takoform host、別クラウド、ローカル host でも同じ Takos contract を実装できます。Cloudflare
Workflows を直接使う実装は Cloudflare adapter の選択肢であり、Takosumi Cloud や Takos 本体の必須条件では
ありません。

## 各コンポーネントの役割

| コンポーネント | 役割 |
| --- | --- |
| `takos-worker` | Thread / agent Run / message / memory / skill / tool と lease で保護した engine checkpoint の正本、queue、agent-control RPC、atomic な完了 |
| executor host DO | container pool の capacity、run lease、起動・cancel・heartbeat。実装は同じ Worker deploy unit に含みます |
| `takos-agent` container | 上限つきの model / tool loop、provider との通信、engine checkpoint の生成と再開。product state は持ちません |
| `takos-agent-engine` | container から使う Rust library。deployable service や別の control plane ではありません |
| installed Capsule / external MCP server | computer、browser、file、Git、storage、Web search などの追加 capability を MCP tool として提供します |
| Takosumi | agent runtime を含む Capsule の OpenTofu による生成と credential / policy。agent の会話の正本は持ちません |

Takos のコードは、Worker と container の間の通信形式を `src/contracts` 経由で呼び出します。service 間の型を
generic な共通 package に複製しません。

Cloudflare profile では `src/worker/cloudflare-entrypoint.ts` が deploy entrypoint となり、default export の
`src/worker/index.ts` が Hono routes と agent Containers DO class (`ExecutorContainerTier*`) を同じ deploy
unit として export します。agent-control callback は `/api/internal/v1/agent-control/*` を同一 Worker 内で受け、
service binding が無い環境では Worker adapter が process 内の agent host binding を合成します。
`RUNTIME_HOST` は互換用の外部接続であり、Takos の通常 install が汎用 runtime container を内蔵することは
ありません。

## 1 Run の流れ

1. `takos-worker` が agent Run を作り、決定済みの model を含む版付きの queue message を送ります。
2. executor host が capacity を予約し、`serviceId + leaseVersion` で fence した run 専用の token を
   container へ渡します。
3. container は正本の会話履歴、Worker が管理する system prompt、選択済みの skill context、許可済みの tool
   catalog を agent-control RPC から取得します。
4. Rust wrapper は上限つきの model / tool loop だけを実行します。tool call はすべて Worker へ戻し、
   permission、schema、重複実行の安全性、timeout、result size を Worker が検証します。各 node の checkpoint は
   累積の provider usage を含む envelope として、agent-control RPC 経由で Run へ lease の版で保護して
   保存します。
5. 最後に構造化した assistant / tool の実行記録、usage、status、terminal event を `complete-run` で 1 つの
   transaction に commit します。同じ transaction が info-unit / thread-context index の永続化する outbox を
   作ります。
6. notifier と index queue は commit 後の配送です。失敗しても SQL の terminal evidence と outbox から
   再送できます。

heartbeat が止まった container の run は、新しい lease で queue に戻されます。古い container の token、
checkpoint の書き込み、tool 実行は、lease の版が一致しないため拒否されます。新しい container は Worker が
管理する checkpoint から、何度実行しても結果が同じ node を再開できます。model への request には provider に
依存しない「ちょうど一度」の保証が無いため、`run_model` の中断点だけは自動で再発行せず安全側に停止します。
checkpoint は Run の recovery metadata であり、Thread の履歴や memory の正本にはしません。terminal の
`complete-run` は checkpoint への pointer も同じ transaction で消去します。副作用の remote での結果が不明な
場合は、tool operation ledger を正本として Run を安全側に失敗させ、checkpoint 保存前に container が落ちても
新しい lease は model / tool を再実行しません。

## Tool の境界

Takos core が直接持つ tool は、Takos 自身が正本を持つ操作だけです。対象は memory / reminder、artifact、
sub-agent orchestration、skill、MCP connection の管理、tool discovery、chat attachment、既知 URL の
`web_fetch` です。

次の capability は Takos core に内蔵しません。

- container / shell / desktop / browser / file 操作 — install した `takos-computer` 等の Capsule が MCP と
  して提供します
- object storage / SQL / KV — install した Capsule が service output から projection して提供します
- Git 操作 — install した Git capability または repo 固有の MCP が提供します
- deploy / domain / infrastructure 操作 — Takosumi の Run / API または install した operator tool が提供します
- Web search — external MCP または install した search Capsule が提供します。`web_fetch` は検索 tool では
  ありません

MCP server の annotation はヒントであり、security の根拠ではありません。external tool は、取得した schema
fingerprint をユーザーが Connections で個別に enable し、実行直前にも現在の schema と policy を再検証します。
MCP の catalog / output には run 単位の件数・byte・timeout 上限を適用します。`destructiveHint` または Takos
の `high` risk 分類は、external / local / Capsule publication を問わず、引数に紐づけた一回限りのユーザー確認を
要求します。tool / Web / repository / MCP / memory の内容は信頼できないデータであり、そこに埋め込まれた指示を
ユーザー由来の意図や確認として扱いません。

## Memory と検索index

- Thread message と明示的な `remember` memory は永続化する product state です。
- info unit / thread context は terminal Run や古い message から再生成できる派生の検索 index です。
- vector embedding が失敗しても SQL の evidence は残しますが、job は成功扱いにせず retry します。
- Rust engine の memory-aware profile は library / test 用途です。Takos の production run は
  `ExternalContext` profile を使い、container-local の memory graph へ会話を複製しません。

## Provider boundary

Provider へ渡す会話 / tool の実行記録は、provider に依存しない構造化した形で保持します。current container の
network adapter は OpenAI-compatible Chat Completions transport です。将来 native provider adapter を追加しても、
Thread / Run / tool / memory の正本を container 側へ移さず、同じ構造化した実行記録と atomic な完了 contract
へ変換します。

## 現在の制約

次は authority の漏れではなく、現在の実装が明示的に持つ制約です。

- crash / stale-lease の recovery は、Worker が管理する lease で保護した engine checkpoint から、何度実行しても
  結果が同じ node を再開します。tool の副作用は operation ledger で重複を排除し、結果が不確かなものは
  `uncertain` として記録して止めます。致命的な失敗のあとは、理由を持たない terminal checkpoint で直前の
  Running pointer を上書きせず、recovery では operation ledger を致命的失敗の正本として優先します。provider
  に依存しない「ちょうど一度」の保証ができない `run_model` の中断点は、自動で再発行せず Run を安全側に
  失敗させます。
- checkpoint protocol v2 は致命的失敗の構造化した応答を明示的に交渉します。段階的に切り替えている最中の v1
  wrapper には同じ正規化された reason を再試行不可の RPC error として返し、旧 wrapper が `Cancelled`
  checkpoint を通常の再開対象として扱わないようにします。
- model の network adapter は OpenAI-compatible Chat Completions のみです。provider に依存しないのは永続化する
  実行記録と engine interface であり、Anthropic 等の native wire adapter を実装済みという意味ではありません。
- Worker isolate 内の MCP / tool resolver cache は latency 削減のための最適化です。isolate を跨ぐ catalog /
  execute は再構築され、実行直前の DB policy・schema fingerprint・lease・Takos Principal の owner proof の
  再検証が根拠です。
- `wait_agent` は child Run ledger を上限つきで polling します。Run Notifier を使う永続化した起動 protocol
  ではありません。
- production では短命な AI Gateway credential が既定です。deployment-global の `OPENAI_API_KEY` を agent
  container へ渡す経路は既定で拒否され、self-host operator が
  `TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY=true` を明示した場合だけ、安全性を下げる設定として有効になります。
- terminal の実行記録の大きな message と 512 KiB を超える engine checkpoint は object storage へ一時保存します。
  正常な checkpoint 置換・terminal commit では参照 object を削除します。commit 応答自体が不明な場合は参照中の
  object を消さないことを優先するため、残り得る未参照の一時 object の回収は bucket lifecycle policy に
  依存します。

## ローカル実行

ローカル開発のサービス構成は
[ローカル開発ガイド](/get-started/local-development) を参照してください。
本番のデプロイ設計は [デプロイ](/deploy/) を参照してください。
