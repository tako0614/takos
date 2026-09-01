# takos-agent

> Internal service of [Takos](../../README.md). 公開 product overview と Quickstart
> は親 README を参照してください。

`takos-agent` はTakosのrun-scoped agent execution serviceです。`takos-agent-engine`をRust libraryとして利用し、
bounded agent loop、structured conversation/tool transcript、Worker提供contextのmodel request化、model adapter、tool bridgeを扱います。
Takos Workerが所有するagent-control RPCと接続します。

このディレクトリの正本責務は次です。

- agent loop orchestration
- engine checkpointの生成・resume (durable保存とlease authorityはWorker)
- Workerがexact RunContextから解決したmodel / system prompt / canonical SQL historyのstructured model入力化
- Workerが同じRun authorityで固定したSkill descriptor planを検証し、instructionsはtool activation後のstructured resultとしてだけ反映
- model runner wiringと、実際にserializeしたprovider requestの送信直前authority fence
- Takos Workerとのagent-control RPC client
- remote tool 実行の bridge

## 境界

Takos の agent architecture では、「all Rust」にする対象を container
の内側に限定します。

Rust container がrun中に持つもの:

- 推論ループ
- exact transcript cutまでのcanonical SQL historyを入力にしたcontext assembly
- Worker提供contextのstructured model request化
- model runner wiring

Takos Workerが正本として持つもの:

- run queue と run lifecycle 管理
- cumulative usageを含むlease-fenced engine checkpointのdurable保存とterminal時の消去
- exact RunContext revisionへ結び付いたcontent-freeなmodel-call begin ledger
- Thread / summary / durable memory and retrieval state / Workspace state（current exact model inputはmutable summary/retrievalを参照しない）
- remote tool catalog、immutable ToolDescriptor revision、authorization、execution、idempotency
- managed/custom skill catalogと永続化
- agent container を起動する executor pool host process

Container diskやpool slotはproduct stateの正本ではありません。restart / 別slot後も、in-flight RunはWorker-owned checkpointから
idempotent nodeをresumeし、別RunのconversationはTakos Workerのcanonical historyから構築します。TakosumiはCapsule / ContainerServiceのdeploy、credential、OpenTofu Run ledgerを
管理しますが、Takos固有のconversation / memory / skill / tool-control RPCはTakos Workerが所有します。
remote side effectのoutcomeが不明な場合はWorker-owned tool operation ledgerをauthorityとして復元し、新leaseはmodel/toolを再実行せず
同じfail-closed outcomeをatomic completionします。
provider requestも、request digestとlogical transport attemptで固定したWorker-owned begin rowを送信前に必要とします。同一processの
begin応答喪失は同じnonceで再確認できますが、replacement processは同じrequest/attemptを新しいnonceで再beginできないため再送しません。

## 主要モジュール

- `src/main.rs`
  - `/start` entrypoint。Takos Worker agent-control RPCからbootstrapしてagent loopを起動
- `src/engine_support.rs`
  - agent engine support wiring
- `src/tool_bridge.rs`
  - correlated tool callをTakos Workerのremote tool executionへbridge
- `src/control_rpc.rs`
  - Takos Worker agent-control RPC contract client
- `src/model.rs`
  - provider request serialization、exact digest begin fence、OpenAI-compatible transport

## Contract

`takos-agent` は remote tool backend を内包しません。tool 実行は次の 2 層です。

Workerはfull native/MCP catalogを内部に保ったまま、modelへ直接見せるbounded集合を選び、schema、risk、side effect、required grant、adapter identityをimmutable `ToolDescriptorRevision`としてRunContextへ固定してからcatalog v2を返します。Rustはtoolを追加・再選別しません。明示的なlow-risk read-only toolだけをparallel実行し、未分類・high-risk・side-effecting toolはprovider順に直列実行します。外部MCPのannotationだけでread-onlyへ昇格させません。
catalogは固定前のsource authorityと固定後のactive authorityを返します。wrapperはsourceがSkill/model input authorityと一致し、active revisionが同じRunGrant上で同一または直後のrevisionであることを検証し、active attestationを各tool executeへ必ず送り返します。欠落・不正なdigest、catalog v2以外、未pin/driftしたdescriptorはlocal fallbackせずRunを停止します。
one-time MCP confirmationはcontainerがbearer tokenとして保持しません。承認claimのIDはWorker-owned RunGrant/contextのdigestへ
含まれ、wrapperが同じattestationを返したtool executeに対してだけWorkerがexact invocationと一回限り消費を検証します。

tool observabilityはbounded `tool_call` / `tool_result` run eventに集約し、`tool_result`は`duration_ms`と4KiB以下のpreviewを
持ちます。terminal assistant message metadataへ全tool executionを再添付しないため、exact correlated transcriptとeventを
二重保存せず、大量tool callでも`complete-run` metadata上限を超えません。

`/start` は executor pool host から渡される `executorTier` / `executorContainerId`
を受け取り、全 agent-control RPC に `X-Takos-Executor-Tier` /
`X-Takos-Executor-Container-Id` として転送します。 これにより tiered executor
pool の token verify / heartbeat / token revoke は Rust container でも同じ
contract で動きます。

`/start` は executor pool host からのみ呼ばれる internal entrypoint です。
`TAKOS_AGENT_START_TOKEN` を設定し、リクエストには
`Authorization: Bearer <TAKOS_AGENT_START_TOKEN>` を付けます。未設定時は
`503`、bearer token が欠落または不一致の場合は `401` を返します。

同時実行上限は `MAX_CONCURRENT_RUNS` で指定します。未設定時の既定値は `5`
です。tiered executor pool では tier1 container に `4`、tier3 の各 container に `32`
を注入し、tier3 pool 自体は最大 `25` instance です。同じ`runId`かつ同じservice/leaseのduplicate `/start`はacceptedとして扱います。異なる新leaseなら
旧taskをcancelしてreplacementを起動します。別runが上限を超えた場合は`503 At capacity`を返します。

current imageのaccepted `/start` responseは`runtimeProtocolVersion: 5`を返します。executor hostは予約時点ではtokenをversionless
(rolling v1-compatible)にし、exact tokenを受け取ったresponseがv2、v3、v4、v5を明示した場合だけそのtokenを昇格します。v2以降のtokenはatomic
`complete-run`を必須とし、v3以降はさらに各provider attempt前の`model-call-begin`と、completed terminal CASでのexact begin row証明を必須にします。v4はdescriptor-only Skill bootstrapとper-manual RunContext activation、v5はWorker-owned tool catalog v2とexact ToolDescriptor activationを必須にします。
rolling中の旧v2 imageは既存contractのまま動きます。rollback用に、`complete-run` endpointが明確な404/405の場合だけnew wrapperがlegacy
`add-message` + `update-run-status`へ一時fallbackします。409 / 410 / auth error / 5xxではfallbackしません。このbridgeは1 release後に
削除対象です。

agent-control RPCのcanonical pathはTakos Workerの`/api/internal/v1/agent-control/*`です。containerはrun-scoped
tokenでこのpath familyを呼び、Workerがtenant/thread/run/leaseをtoken-bound stateから解決します。

- `TAKOS_AGENT_CONTROL_RPC_BASE_URL` / `TAKOS_AGENT_CONTROL_RPC_TOKEN`
  - `/api/internal/v1/agent-control/*` 用の明示的な設定名
- `/start` payload の `controlRpcBaseUrl` / `controlRpcToken`
  - executor pool host から渡される run-local RPC 設定
- `TAKOSUMI_INTERNAL_URL`
  - tenant/platform Takosumi internal API 用。agent-control RPC の bearer-token transport
    base としては使わない

Takos Workerはexact `run-model-input`、Skill descriptor context、tool catalog / execute、model-call begin、engine checkpoint save・load、heartbeat、status update、run eventを公開します。current v5 wrapperは`run-bootstrap`、`run-config`、`conversation-history`を個別には呼びません。これらのlegacy endpointはrolling中の旧image用です。caller-supplied history/tool名を受け取ってbulk Skill contentを返していた`skill-plan` / `skill-catalog` endpointは削除済みです。

`run-model-input`はexact Run authority、model ID、Worker-owned system prompt/profile、budget、base transcript cutまでのcanonical SQL historyを一つのresponseで返します。queue `/start` payloadのmodel、caller-supplied history/tool名、post-cut message、mutable Thread summary/key point、Vectorize hit、R2 full-bodyはmodel input authorityになりません。Run inputはcontextに本文を複製せずdigest一致を検証し、Capsule/app contextは`capsuleId` / `runtimeNamespace`だけをbounded bootstrap identityとして返します。prompt/profile revisionやRun input digestを再現できなければlocal copyへfallbackせずRunを停止します。

Skill contextは、Workerがpinned historyと実際のWorker tool catalogから初回planを解決し、zero-selectionを含むRun-owned plan、選択Skill content、宣言されたオンデマンド資料をimmutable revisionとして保存します。bootstrap responseはplanのdescriptor countとactive authorityだけで、instructions、resolution context、MCP/template一覧、資料本文をcontainerへ渡しません。wrapperはこのRPCを先に呼び、続く`run-model-input` authorityと一致すること、さらにtool catalogのsource authorityが同じで、active authorityがdescriptor固定による直後のrevision以下であることをprovider送信前に検証します。modelは`toolbox search`でplan由来manualとWorkerのfull internal tool catalogを検索します。`toolbox describe`したexact manual content、resource本文、tool schemaは、同じtool-call identityで次RunContextへcommitされた後にだけ返ります。`toolbox call`もdescriptor activationからtarget実行まで外側のcall IDを維持します。応答喪失retryは同じrevisionへ収束し、競合activationはforkを作りません。mutable custom Skill/managed image/tool schemaの更新はactive Runへ混ざらず、削除済み・unavailable manualや未pin/driftしたtoolは使いません。Rustはmanifest、本文、local tool catalogを一括注入せず、remote `toolbox`のstructured resultを通すだけです。
`takos-agent`はAccounts ledgerやCapsule lifecycleを所有しません。engineは
`ExecutionProfile::ExternalContext`を明示し、local ingest / activation / distillation / session overflowを通さないbounded model/tool
loopだけを使います。engine checkpointのdurable authorityはWorkerのRun ledgerで、container diskをrecovery authorityにしません。
idempotent tool nodeはresumeできますが、`uncertain` side effectはoperation ledgerからfatal reasonを復元し、直前のRunning
checkpointをreasonless terminal stateで上書きせず再実行を防ぎます。provider-neutralなidempotency contractがないmodel nodeも
自動再発行せずfail closedします。
runtime protocol v5は、v4のdescriptor-first Skill activationにWorker-owned catalog v2とToolDescriptor activationを加えます。tool結果のcommit直後かつ次checkpoint保存前にcrashした場合は、保存済みrevisionがcurrent revisionの検証済みancestorであるときだけoperation ledgerから安全にresumeします。manual/resource/tool descriptorのactivationはRunContext自身のCAS/idempotencyでreplayし、別のpending tool-operationを作りません。新Workerのcatalog追加fieldは旧v4 imageが無視できますが、v5 imageはcatalog v2とsource/final authorityを要求するため旧Worker responseを拒否します。releaseはWorkerを先に更新します。v2はfatal responseのrolling compatibilityとしてbase revisionのread-only Runに限ってWorker側でattestationを補います。v1 wrapperには既存mapperが理解するcanonical RPC errorを返します。
`spaceId` / `installationId`をdurable filesystem namespaceとして使いません。

`run-model-input.config` のbudgetは`maxGraphSteps` / `maxToolRounds`を正本のfield nameとして読みます。欠落・範囲外・snake_case alias・旧`maxIterations` / `rateLimit`は受理しません。値はRunContext / RunGrantで固定され、containerのengine defaultやqueue payloadで上書きしません。

current exact model inputは、base transcript cutまでのcanonical SQL messageだけを使います。mutable Thread summary、Vectorize recall、offload済みmessageのR2 full-bodyをその場で混ぜず、SQLに残るbounded previewを決定的に使います。semantic retrievalはimmutable `TurnProjection` referenceをRunContextへpinする移行が完了してからこの経路へ戻します。production wrapperのexternal-context profileはengine-local embedding / memory repositoryへturnを複製せず、消えるper-container indexを第二のmemory authorityにしません。memory-aware engine profileとdeterministic hash embedderはlibrary/test supportとして残します。

## Repository layout

この service は `takos-agent-engine` の sibling checkout を使って build します。
Docker image は ecosystem root を build context にして、`takos/containers/agent` と
`takos-agent-engine` を同じ context に入れます。

```text
takos/
  containers/
    agent/
      Cargo.toml
      Dockerfile
      src/
takos-agent-engine/
  Cargo.toml
  src/
```

Docker image は ecosystem root から作成します。

```sh
docker build -f takos/containers/agent/Dockerfile -t takos-agent .
```

release artifact publisher は `containers/agent/engine-source.json` の exact commit を
canonical `tako0614/takos-agent-engine` remote から一時 build context へ fetch し、
Docker build 内の `cargo build --locked --release` で wrapper compatibility を検証します。
local sibling checkout は release source authority には使いません。

Live smoke は opt-in です。`TAKOS_AGENT_INTERNAL_URL` が未設定の場合は skip
します。設定されている場合だけ `GET /health` を確認します。

```sh
bash scripts/live-smoke.sh
```

`takos-agent-engine` の sibling checkout に対する local path patch は、repo を汚さない一時 Cargo manifest copy で検証します。

```sh
bash scripts/check-local-engine.sh
```

- model-visible catalog / tool discovery
  - Takos Worker の remote catalog、direct-tool selection、pinned ToolDescriptorが正本
  - `CompositeToolExecutor::exposed_tools()` はWorkerがcatalog v2で返したremote toolsだけをそのまま公開し、local selector/fallbackを持ちません
  - full native/MCP catalogの検索・describe・callと、on-demand descriptor activationもWorkerの`toolbox`を通します
  - tool実行はcontrol RPCを通り、Workerがpinned descriptorとlive policy/schemaを再検証します
- skill context
  - Rust はTakos WorkerからSkill instructionsを受け取らず、system contextへのbulk injectionを行いません
  - modelが`toolbox describe`したmanualだけをWorkerがexact RunContextへactivateし、structured tool resultとして返します
  - manualのresource manifestは本文を含まず、exact resource activation後の本文も通常のremote tool resultとしてだけ渡します
  - `skill_list` / `skill_get` / CRUD は remote tool として実行し、Rust 側で
    同名 call を intercept しません

container imageにはmanaged skill snapshotを持ちません。tool/skillの追加・削除・annotations・認可はTakos Worker側の
catalogを正本として扱います。
