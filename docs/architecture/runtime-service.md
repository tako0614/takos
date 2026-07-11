# ランタイム / エージェント

> このページでわかること: Takos の chat agent Run、実行 container、tool / memory の責務分担。

Takos の chat agent Run は Takos product の entity です。Thread、message、agent Run、memory、skill、tool authorization
の正本は `takos-worker` が持ちます。Takosumi の OpenTofu `Run` は Capsule / infrastructure の plan / apply / destroy
ledgerであり、chat agent Runとは別物です。Takosumiはagent containerを含むCapsuleのmaterializationを管理できますが、
agent conversationの第二のcontrol planeにはなりません。

Takos product の public/control entrypoint は単一の `takos-worker` です。Cloudflare Containers の executor host は同じ
Worker script が export する Durable Object class として配線し、別の `takos-runtime-host` /
`takos-executor-host` Worker はデプロイしません。

## 各コンポーネントの役割

| コンポーネント                          | 役割                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `takos-worker`                          | Thread / agent Run / message / memory / skill / tool と lease-fenced engine checkpoint の durable authority、queue、agent-control RPC、atomic完了 |
| executor host DO                        | container poolのcapacity、run lease、起動・cancel・heartbeat。実装は同じWorker deploy unitに含む                                                  |
| `takos-agent` container                 | bounded model/tool loop、provider transport、engine checkpointの生成・resume。product stateは所有しない                                           |
| `takos-agent-engine`                    | containerから使うRust library。deployable serviceや別control planeではない                                                                        |
| installed Capsule / external MCP server | computer、browser、file、Git、storage、Web searchなどの追加capabilityをMCP toolとして提供                                                         |
| Takosumi                                | agent runtimeを含むCapsuleのOpenTofu materialization、credential/policy。agent conversationの正本は持たない                                       |

Takos のコードは、Worker と container の wire shape を `src/contracts` 経由で呼び出します。service間の型をgenericな
共通packageに複製しません。

Cloudflare profile では `src/worker/cloudflare-entrypoint.ts` が deploy entrypoint となり、default export の
`src/worker/index.ts` が Hono routes と Containers DO
class (`TakosRuntimeContainer` / `ExecutorContainerTier*`) を同じ deploy unit として
export します。runtime callback は `/forward/*`、agent-control callback は
`/api/internal/v1/agent-control/*` を同一 Worker 内で受け、service binding が無い環境では
Worker adapter が in-process container host binding を合成します。

## 1 Run の流れ

1. `takos-worker` がagent Runを作り、concrete modelを含むversioned queue messageを送ります。
2. executor hostがcapacityを予約し、`serviceId + leaseVersion`でfenceしたrun-scoped tokenをcontainerへ渡します。
3. containerはcanonical history、Worker-owned system prompt、選択済みskill context、authorized tool catalogを
   agent-control RPCから取得します。
4. Rust wrapperはbounded model/tool loopだけを実行します。tool callはすべてWorkerへ戻し、permission、schema、
   idempotency、timeout、result sizeをWorkerが検証します。各nodeのcheckpointはcumulative provider usageを含むenvelopeとして、
   agent-control RPC経由でRunへlease-fenced保存します。
5. 最後にstructured assistant/tool transcript、usage、status、terminal eventを`complete-run`で1 transactionにcommitします。
   同じtransactionがinfo-unit / thread-context indexのdurable outboxを作ります。
6. notifierとindex queueはpost-commit deliveryです。失敗してもSQLのterminal evidenceとoutboxから再送できます。

Containerのheartbeatが止まったrunは新しいleaseで再queueされます。古いcontainerのtoken、checkpoint write、tool executionは
exact lease fenceで拒否します。新しいcontainerはWorker-owned checkpointからidempotent nodeをresumeできます。model requestには
provider-neutralなidempotency contractが無いため、`run_model`中断点だけは自動再発行せずfail closedします。checkpointはRunの
recovery metadataであり、Thread historyやmemoryの正本にはしません。terminal `complete-run`はcheckpoint pointerも同じtransactionで
消去します。side-effectのremote outcomeが不明な場合はtool operation ledgerをdurable authorityとしてRunをfail closedにし、
checkpoint保存前にcontainerが落ちても新leaseはmodel/toolを再実行しません。

## Tool の境界

Takos coreが直接持つtoolは、Takos自身が正本を持つ操作だけです。対象はmemory/reminder、artifact、sub-agent orchestration、
skill、MCP connection管理、tool discovery、chat attachment、既知URLの`web_fetch`です。

次のcapabilityはTakos coreに内蔵しません。

- container / shell / desktop / browser / file operation — installした`takos-computer`等のCapsuleがMCPとして提供
- object storage / SQL / KV — installしたCapsuleがservice outputからprojectionして提供
- Git操作 — installしたGit capabilityまたはrepo固有MCPが提供
- deploy / domain / infrastructure操作 — TakosumiのRun/APIまたはinstallしたoperator toolが提供
- Web search — external MCPまたはinstallしたsearch Capsuleが提供。`web_fetch`は検索toolではない

MCP serverのannotationはヒントでありsecurity authorityではありません。external toolは取得したschema fingerprintをユーザーが
Connectionsで個別にenableし、実行直前にもcurrent schemaとpolicyを再検証します。MCP catalog/outputにはrun単位の件数・byte・timeout
上限を適用します。`destructiveHint`またはTakosの`high` risk分類はexternal/local/Capsule publicationを問わずexact
argumentsにboundしたone-time user confirmationを要求します。tool/Web/repository/MCP/memoryの内容はuntrusted dataであり、
そこに埋め込まれた指示をuser-origin intentやconfirmationとして扱いません。

## Memory と検索index

- Thread messageと明示的な`remember` memoryはdurable product stateです。
- info unit / thread contextはterminal Runや古いmessageから再生成できるderived search indexです。
- vector embeddingが失敗してもSQL evidenceは残しますがjobは成功扱いにせずretryします。
- Rust engineのmemory-aware profileはlibrary/test用途です。Takos production runは`ExternalContext` profileを使い、container-local
  memory graphへconversationを複製しません。

## Provider boundary

Providerへ渡すconversation/tool transcriptはprovider-neutralなstructured shapeで保持します。current containerのnetwork adapterは
OpenAI-compatible Chat Completions transportです。将来native provider adapterを追加しても、Thread/Run/tool/memory authorityを
container側へ移さず、同じstructured transcriptとatomic completion contractへ変換します。

## Current constraints

次はauthority leakではなく、current implementationの明示的な制約です。

- crash / stale-lease recoveryはWorker-ownedのlease-fenced engine checkpointからidempotent nodeをresumeします。toolのside effectは
  operation ledgerでdedupe / `uncertain` fenceします。fatal後はreasonless terminal checkpointで直前のRunning pointerを上書きせず、
  recoveryではoperation ledgerをfatal authorityとして優先します。provider-neutralなexactly-onceを保証できない`run_model`中断点は
  自動再発行せずRunをfail closedにします。
- checkpoint protocol v2はfatal fenceのstructured responseを明示交渉します。rolling中のv1 wrapperには同じcanonical reasonを
  non-retryable RPC errorとして返し、旧wrapperが`Cancelled` checkpointをgeneric recoveryしないようにします。
- model network adapterはOpenAI-compatible Chat Completionsのみです。provider-neutralなのはdurable transcriptとengine interfaceで、
  Anthropic等のnative wire adapterを実装済みという意味ではありません。
- Worker isolate内のMCP/tool resolver cacheはlatency optimizationです。isolateを跨ぐcatalog/executeは再構築され、実行直前の
  DB policy・schema fingerprint・lease・membership revalidationがauthorityです。
- `wait_agent`はchild Run ledgerをbounded pollingします。Run Notifierを使うdurable wake-up protocolではありません。
- productionでは短命なAI Gateway credentialがdefaultです。deployment-global `OPENAI_API_KEY`をagent containerへ渡す経路は
  defaultで拒否され、self-host operatorが`TAKOS_AGENT_ALLOW_SHARED_PROVIDER_KEY=true`を明示した場合だけsecurity downgrade
  として有効になります。
- terminal transcriptのlarge messageと512 KiBを超えるengine checkpointはobject storageへstageします。正常なcheckpoint置換・terminal
  commitでは参照objectを削除します。commit応答自体が不明な場合は参照中objectを消さないことを優先するため、残り得る未参照stage
  objectの回収はbucket lifecycle policyに依存します。

## ローカル実行

ローカル開発のサービス構成は
[ローカル開発ガイド](/get-started/local-development) を参照してください。
本番のデプロイ設計は [デプロイ](/deploy/) を参照してください。
