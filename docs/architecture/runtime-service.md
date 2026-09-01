# ランタイム / エージェント

> このページでわかること: Takos の chat agent Run、実行 container、tool / memory の責務分担。

Takos の chat agent Run は Takos product の entity です。Thread、message、agent Run、memory、skill、tool authorization
の正本 (正とする情報)は `takos-worker` が持ちます。Takosumi の OpenTofu `Run` は Capsule / infrastructure の plan / apply / destroy
ledgerであり、chat agent Runとは別物です。Takosumiはagent containerを含むCapsuleのmaterializationを管理できますが、
agent conversationの第二のcontrol planeにはなりません。

Takos product の public/control entrypoint は単一の `takos-worker` です。Cloudflare Containers の executor host は同じ
Worker script が export する Durable Object class として配線し、別の `takos-runtime-host` /
`takos-executor-host` Worker はデプロイしません。

## 実行モデル

Takos は Cloudflare Agents SDK の責務分離を参考にしますが、SDK 自体を product
contract にはしません。

| 責務 | Takos の正本 | Cloudflare へ直接置く場合の adapter |
| --- | --- | --- |
| Agent の identity、Thread、message、状態 | `takos-worker` と product DB / StatefulEntity | Worker と Durable Object |
| 長時間・再試行可能な Run | Queue、lease、checkpoint、operation ledger | Queue と Container host。将来 Workflows を使う実装も adapter として追加可能 |
| model / tool loop | `takos-agent` ContainerService | Cloudflare Container |
| tool discovery / connection | Workspace の MCP と installed Capsule Interface | Worker binding / service bindingへprojection |
| shell、browser、desktop、Git Actions | Takos core の外。installした app または外部runtime | `takos-computer`、`takos-git`など |

この分離により、Cloudflare Agents SDK の永続 agent、streaming、MCP、Workflow
連携と同じ設計上の利点を保ちながら、Takoform host、別クラウド、ローカルhostでも
同じ Takos contract を実装できます。Cloudflare Workflows を直接使う実装は
Cloudflare adapter の選択肢であり、Takosumi Cloud や Takos 本体の必須条件では
ありません。

## 各コンポーネントの役割

| コンポーネント                          | 役割                                                                                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `takos-worker`                          | Thread / agent Run / RunGrant / RunContextRevision / message / memory / skill / tool、lease-fenced engine checkpoint、model-call begin ledger の永続 authority、queue、agent-control RPC、atomic完了 |
| executor host DO                        | container poolのcapacity、run lease、起動・cancel・heartbeat。実装は同じWorker deploy unitに含む                                                  |
| `takos-agent` container                 | bounded model/tool loop、provider transport、engine checkpointの生成・resume。product stateは所有しない                                           |
| `takos-agent-engine`                    | containerから使うRust library。deployable serviceや別control planeではない                                                                        |
| installed Capsule / external MCP server | computer、browser、file、Git、storage、Web searchなどの追加capabilityをMCP toolとして提供                                                         |
| Takosumi                                | agent runtimeを含むCapsuleのOpenTofu materialization、credential/policy。agent conversationの正本は持たない                                       |

Takos のコードは、Worker と container の wire shape を `src/contracts` 経由で呼び出します。service間の型をgenericな
共通packageに複製しません。

Cloudflare profile では `src/worker/cloudflare-entrypoint.ts` が deploy entrypoint となり、default export の
`src/worker/index.ts` が Hono routes と agent Containers DO class
(`ExecutorContainerTier*`) を同じ deploy unit として export します。agent-control
callback は `/api/internal/v1/agent-control/*` を同一 Worker 内で受け、service
binding が無い環境では Worker adapter が in-process agent host binding を合成します。
`RUNTIME_HOST` は互換用の外部接続であり、Takos の通常installが汎用runtime
containerを内蔵することはありません。

## 1 Run の流れ

1. `takos-worker` がpending agent Run、allowlistだけで構成したenforced `RunGrant`、shadow base `RunContextRevision`を一つのD1 atomic batchで作り、versioned queue messageを送ります。queue messageにもmodel fieldは残りますがtransport metadataであり、current containerのmodel選択authorityではありません。承認済みMCP呼び出しを引き継ぐ場合は、そのexact one-Run claimも同じbatchで作ります。base revisionはprincipal、Workspace、Thread、transcript sequence cut、model/prompt/profile digest、Run input digest、exact graph/tool budget、grant/confirmation referenceだけを保持し、Run input本文、message本文、prompt本文、credential、env値、tool resultを複製しません。
2. executor hostがcapacityを予約し、`serviceId + leaseVersion`でfenceしたrun-scoped tokenをcontainerへ渡します。
3. current containerは最初にSkill runtime contextを要求します。Workerはcurrent exact model inputと実際のtool catalogだけから初回planを解決し、zero-selectionを含むRun-owned planと選択Skill contentをimmutable revisionとして保存します。Skillがオンデマンド資料を宣言している場合は、plan作成時のlocaleに対応する本文もcontent-addressed `skill_resource_revisions`へ固定します。この時点の次`RunContextRevision`へ追加するのはplan referenceだけで、instructionsや資料本文はcontainerへ返しません。containerは返されたactive authorityで`run-model-input`を取得した後、Worker-owned tool catalog v2を要求します。Workerはbounded direct toolsを選び、そのexact `ToolDescriptorRevision`を次revisionへappendしてからcatalogを返します。catalogのsource authorityはSkill/model input authorityと一致し、final authorityは同じrevisionまたはこのdescriptor activationによる直後のrevisionだけでなければcontainerが停止します。model inputはdigest一致を確認したmodel、system prompt/profile、budget、Run inputに由来するbootstrap identity、base transcript cutまでのcanonical SQL historyを一つのimmutable `TurnProjection`として固定します。自動recallはcurrent Threadの古いcompleted semantic turnだけを最大12 chunkから探し、SQL正本へ再照合した最大3 blockとそのexact projection digestを同じsnapshotへpinします。post-cut message、別Threadの生会話、mutable Thread summary/key point、legacy per-message Vectorize本文、R2 full-body substitutionを混ぜません。
4. Rust wrapperはbounded model/tool loopだけを実行し、選択Skill instructionsをsystem messageへ一括注入せず、Workerが返した固定済みtool定義を追加・再選別しません。modelは`toolbox search`でplan由来manualとfull internal tool catalogのbounded descriptorだけを検索します。`toolbox describe`したmanualはexact content revision、toolはexact schema/risk/side-effect/adapter revisionが同じtool-call identityで次`RunContextRevision`へCAS appendされた後にだけ返ります。manual resultが公開するのはbounded resource manifestだけです。資料本文は、同じmanualを既にactivateしたauthorityからexact `resource_id`を指定したときだけ、親manual referenceと資料referenceを次revisionへatomic appendした後に返ります。`toolbox call`はdescriptor activation、confirmation、operation ledger、target実行まで外側と同じtool-call identityを使います。tool callはすべてWorkerへ戻し、permission、schema、
   idempotency、timeout、result sizeをWorkerが検証します。各nodeのcheckpointはcumulative provider usageを含むenvelopeとして、
   agent-control RPC経由でRunへlease-fenced保存します。current runtimeは各provider HTTP attemptの直前に、実際にserializeしたrequest bodyの
   SHA-256、monotonic transport attempt、exact RunContext / RunGrant attestationを`model-call-begin`へ渡します。Workerはbodyやcredentialを
   保存せず、immutableなbegin rowだけをatomic commitしてから送信を許可します。
5. 最後にstructured assistant/tool transcript、usage、status、terminal eventを`complete-run`で1 transactionにcommitします。
   runtime protocol v3以降のcompleted Runは、同じcurrent revision / context digest / grant digestに属するmodel-call begin rowが無い限り
   terminal CASに勝てません。同じtransactionがinfo-unit / thread-context indexの永続 outboxを作ります。
6. notifierとindex queueはpost-commit deliveryです。失敗してもSQLのterminal evidenceとoutboxから再送できます。

`RunContextRevision`全体はpartial cutover段階です。migration前Runへ推測したrevisionをbackfillせず、新規Runだけrevision 1を持ちます。current runtimeのmodel ID、prompt/profile identity、budget、Run input digest、transcript cut、immutable model-input/semantic `TurnProjection`、選択Skill plan、activate済みSkill content/オンデマンド資料、model-visibleおよびon-demand tool descriptorはexact revisionへcutover済みです。Run inputの本文はRun rowだけに残し、contextはdigestで一致を検証します。digestを持たないlegacy Run、Run input改ざん、prompt/profile revisionやpinned TurnProjection/Skill/resource/tool descriptor rowの消失・改ざんは推測やlive fallbackをせず`context_invalid`として停止します。immutable AgentProfile storeが導入されるまではprompt/profileを変更するdeploy前にactive Runをdrainする必要があります。

containerはtool catalogで受け取ったexact revision/grant digestを各tool executeへ返し、Workerは実行器を作る前に両digestとpinned descriptorを再検証します。通常toolのcapabilityはimmutable `RunGrant`とcurrent Workspace policyの積集合です。direct model-visible catalogは`toolbox`を必須とする最大10種のWorker-owned集合で、full MCP/native catalogは既存の2,048 tools / 8 MiB / 64 servers bound内でtoolbox検索・describe・callに残ります。1 Runは最大32 descriptor、1 descriptorはcanonical JSON 64 KiBです。native adapter revisionはTakos package release identity、MCP adapter revisionはserver/tool/interface schemaから作るsecret-free digestで固定します。native semanticsを同じrelease identityのまま変更してactive Runへ混ぜず、release identity変更時はactive Runをdrainします。MCPは全sourceで実行直前にlive schemaを再取得し、pinned meaningと違えば実行しません。Skill選択はcaller-supplied history/tool名を信用せず、Workerが同じpinned historyと実際のtool catalogから解決します。初回winnerのSkill planはlocale・順序・zero-selection・content digest・resource manifestを固定し、応答喪失retryやmutable custom Skill更新、managed image更新でdescriptor/instructions/resource本文を変えません。manual IDはsource-qualifiedで、同名manualの曖昧なdescribeはexact IDを要求します。MCP server/tool availabilityはliveに狭め、unavailable manualはinstructionsを返しません。manual/resource/tool describeの応答喪失はRunContext activation identityだけでreplayし、別のpending tool-operationを作って`outcome_uncertain`へ誤分類しません。1 Skillあたりの資料は最大8件、本文は1件16 KiB、1 planは最大64件です。manifestはID、title、description、media type、byte size、digestだけを公開し、本文をdescriptor/searchへ混ぜません。資料本文は権限やユーザー意図ではないuntrusted referenceとして扱います。ExplicitMemoryのcontent-addressed immutable rowとprovider credentialのmaterializationは未完了です。

provider requestの送信権限もcurrent exact revisionへcutover済みです。toolによってrevisionが進んだ場合、次のmodel requestは共有attestationの
新revisionでbeginしなければならず、古いrevisionやtombstone済みresourceを含むcontextからの送信はWorker側で拒否します。
一方、child Runの新規作成は親の有効なbase revisionとdigest検証済み`RunGrant`を必須とし、親capability・budgetとcurrent Workspace policyの積集合だけを子Grantへ記録します。親記録がないlegacy Runからの新規delegationは安全側に停止します。

explicit Memory、custom Skill、TurnProjectionの削除はsource rowの単独hard-deleteではありません。content-freeな`agent_resource_tombstones`、削除時点で固定したexact vector/object targetだけを持つ`agent_resource_deletion_outbox`、source row削除を一つのSQL batchでcommitします。custom Skillはversionではなくstable logical resource IDをtombstoneにします。Thread削除は即座に全read/execution pathから外し、同じrequestで最大25 projectionをretireします。応答喪失や大量Threadで残ったprojectionはhourly maintenanceが再発見します。semantic TurnProjection v1はcontent-addressed resource IDから導く最大3個のvector IDを削除時にoutboxへ固定し、provider-firstだった旧失敗点のorphanも回収します。instructionsをまだactivateしていないRunは削除済みmanualのactivateを拒否して継続でき、content revisionやprojectionを既にactivateしたRunは次のlease/model/tool/resume fenceで失効します。provider cleanupはclaim tokenでfenceし、成功ackを失ってもidempotently再実行できます。prefix listingや削除後のprovider状態から推測したtargetはcleanup authorityになりません。Artifact、ExplicitMemory immutable revision、managed Skillの緊急revoke surfaceはまだ未完了です。

Containerのheartbeatが止まったrunは新しいleaseで再queueされます。古いcontainerのtoken、checkpoint write、tool executionは
exact lease fenceで拒否します。新しいcontainerはWorker-owned checkpointからidempotent nodeをresumeできます。model requestには
provider-neutralなidempotency contractが無いため、`run_model`中断点だけは自動再発行せず安全側に停止します。model-call identityは
request digestとlogical attemptでleaseから独立して固定し、同一processのbegin応答喪失だけをephemeral nonceでidempotent retryできます。
replacement processが同じrequest/attemptを再送しようとすると別nonceがimmutable rowと衝突するため、provider requestを再発行しません。checkpointはRunの
recovery metadataであり、Thread historyやmemoryの正本にはしません。terminal `complete-run`はcheckpoint pointerも同じtransactionで
消去します。side-effectのremote outcomeが不明な場合はtool operation ledgerを永続 authorityとしてRunを安全側に停止し、
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

confirmationはWorkspace/user/server/tool/schema/argumentsだけで横断検索しません。要求元のprincipal、Run、Thread、context revision/digest、
RunGrant digest、model-issued tool-call idまでkeyed identityへ固定します。承認後、Web clientは同じThreadの次のuser-originated Runへ
confirmation grant idを明示的に渡し、WorkerはRun/RunGrant/contextと一緒に一回限りclaimします。claimは次のRunのcontext/grant digestへ
固定され、exact server/tool/schema/argumentsに一致した最初のtool-call idだけがatomic compare-and-setで消費できます。別Workspace、別user、
別Thread、claimのないRun、期限切れ、改ざん済みidentity、並行した二重消費はすべてfail closedです。通常のlive Workspace policy、schema、
connection、capability再検証はconfirmationがあっても省略しません。

## Memory と検索index

- Thread messageと明示的な`remember` memoryは永続 product stateです。
- info unit / thread contextはterminal Runや古いmessageから再生成できるderived search indexです。
- Thread messageのVectorize metadataには本文、role、timestampを保存しません。検索hitはboundedなWorkspace / Thread /
  message / sequence識別子としてだけ扱い、active Workspaceの非削除Threadに属するcanonical SQL messageを再読込します。
  deterministic vector ID、message ID、Thread、sequence、supported roleが一致しないstale/forged hitはmodel contextと検索結果から除外します。
- completed Runはuser intentからterminal assistant/tool exchangeまでを一つのcanonical semantic `TurnProjection`としてdual-writeします。本文はSQL revisionだけに置き、Vectorize metadataはWorkspace / Thread / Run / projection / chunk digestだけです。自動recallはcurrent Threadに限定し、直近500 messageと重複するturnを除外して、最大12候補から最大3 blockだけをimmutable model-input projectionへpinします。embedding/vector providerが失敗した場合は同じWorkspace / Thread / tombstone fenceを通るbounded lexical searchへdegradeします。
- semantic vector IDはSQL refを先にcommitしてからproviderへupsertします。provider応答喪失は同じIDで再試行でき、Thread削除時はprojection tombstone/source削除/exact-target outboxをatomic commitしてからclaim-fenced cleanupが削除します。
- vector embeddingが失敗してもSQL evidenceは残しますがjobは成功扱いにせずretryします。
- Rust engineのmemory-aware profileはlibrary/test用途です。Takos production runは`ExternalContext` profileを使い、container-local
  memory graphへconversationを複製しません。

## Provider boundary

Providerへ渡すconversation/tool transcriptはprovider-neutralなstructured shapeで保持します。current containerのnetwork adapterは
OpenAI-compatible Chat Completions transportです。将来native provider adapterを追加しても、Thread/Run/tool/memory authorityを
container側へ移さず、同じstructured transcript、exact request-digest begin fence、atomic completion contractへ変換します。

## Current constraints

次はauthority leakではなく、current implementationの明示的な制約です。

- crash / stale-lease recoveryはWorker-ownedのlease-fenced engine checkpointからidempotent nodeをresumeします。toolのside effectは
  operation ledgerでdedupe / `uncertain` fenceします。fatal後はreasonless terminal checkpointで直前のRunning pointerを上書きせず、
  recoveryではoperation ledgerをfatal authorityとして優先します。provider-neutralなexactly-onceを保証できない`run_model`中断点は
  immutable model-call begin ledgerの同一identity衝突で自動再発行せず、Runを安全側に停止します。これはprovider側のexactly-onceを
  主張するものではなく、Takos側のreplacement executionによる重複送信を防ぐ境界です。
- runtime protocol v5はv4のdescriptor-only Skill bootstrap/per-manual activationに、Worker-owned tool catalog v2とexact ToolDescriptor activationを追加します。v3で導入したexact RunContext checkpoint、model-call begin、atomic completion proofも維持します。新Workerの追加fieldは旧v4 imageが無視できますが、新v5 imageはcatalog v2、source authority、descriptor activation後authorityの関係を検証し、旧Workerを受理しません。releaseはWorkerを先に更新します。rolling中のv2 imageは
  model-call beginを要求しない既存contractのまま動き、v1 wrapperにはfatal時のcanonical reasonをnon-retryable RPC errorとして返します。
- model network adapterはOpenAI-compatible Chat Completionsのみです。provider-neutralなのは永続 transcriptとengine interfaceで、
  Anthropic等のnative wire adapterを実装済みという意味ではありません。
- Worker isolate内のMCP/tool resolver cacheはlatency optimizationです。isolateを跨ぐcatalog/executeは再構築され、実行直前の
  DB policy・schema fingerprint・lease・private Workspace ownership revalidationがauthorityです。
- enforced `RunGrant`はchild作成時のattenuation fenceと通常tool capabilityのimmutable上限です。tool catalogが発行したcontext/grant attestationのないexecute、legacy/shadow/改ざん済みGrant、未pin・欠落・改ざん・driftしたtool descriptorはfail closedにします。同時にcurrent Workspace policy、MCP connection、live schemaを再検証するためsnapshotだけで失効済みcapabilityや古いadapter意味を復活させません。one-time MCP confirmation identity/claimもこのattested authorityと同じdescriptor/schema/argumentsへbindします。
- explicit Memory、custom Skill、TurnProjection削除はcontent-free tombstoneとdurable exact-target cleanup outboxへcutover済みです。custom Skill plan/contentとautomatic TurnProjectionはRunContextへpinされ、logical Skill/projection削除はactive Runを失効させます。ExplicitMemory recallはcontent digestをprogressive referenceとして先にpinしますが、独立したimmutable content rowはまだなく、Artifactとmanaged Skillの緊急revoke surfaceも未完了です。
- `wait_agent`はchild Run ledgerをbounded pollingします。Run Notifierを使う永続 wake-up protocolではありません。
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
