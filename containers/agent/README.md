# takos-agent

> Internal service of [Takos](../README.md). 公開 product overview と Quickstart
> は親 README を参照してください。

`takos-agent` はTakosのrun-scoped agent execution serviceです。`takos-agent-engine`をRust libraryとして利用し、
bounded agent loop、structured conversation/tool transcript、Worker提供contextのmodel request化、model adapter、tool bridgeを扱います。
Takos Workerが所有するagent-control RPCと接続します。

このディレクトリの正本責務は次です。

- agent loop orchestration
- engine checkpointの生成・resume (durable保存とlease authorityはWorker)
- Workerが組み立てたcanonical history / memory contextのstructured model入力化
- Worker提供のsystem prompt / skill contextをmodel requestへ反映
- model runner wiring
- Takos Workerとのagent-control RPC client
- remote tool 実行の bridge

## 境界

Takos の agent architecture では、「all Rust」にする対象を container
の内側に限定します。

Rust container がrun中に持つもの:

- 推論ループ
- canonical historyを入力にしたcontext assembly
- Worker提供contextのstructured model request化
- model runner wiring

Takos Workerが正本として持つもの:

- run queue と run lifecycle 管理
- cumulative usageを含むlease-fenced engine checkpointのdurable保存とterminal時の消去
- Thread / summary / durable memory and retrieval state / Workspace state
- remote tool catalog、authorization、execution、idempotency
- managed/custom skill catalogと永続化
- agent container を起動する executor pool host process

Container diskやpool slotはproduct stateの正本ではありません。restart / 別slot後も、in-flight RunはWorker-owned checkpointから
idempotent nodeをresumeし、別RunのconversationはTakos Workerのcanonical historyから構築します。TakosumiはCapsule / ContainerServiceのdeploy、credential、OpenTofu Run ledgerを
管理しますが、Takos固有のconversation / memory / skill / tool-control RPCはTakos Workerが所有します。
remote side effectのoutcomeが不明な場合はWorker-owned tool operation ledgerをauthorityとして復元し、新leaseはmodel/toolを再実行せず
同じfail-closed outcomeをatomic completionします。

## 主要モジュール

- `src/main.rs`
  - `/start` entrypoint。Takos Worker agent-control RPCからbootstrapしてagent loopを起動
- `src/engine_support.rs`
  - agent engine support wiring
- `src/skills.rs`
  - Workerから取得したskill metadataのruntime context helper
- `src/tool_bridge.rs`
  - correlated tool callをTakos Workerのremote tool executionへbridge
- `src/control_rpc.rs`
  - Takos Worker agent-control RPC contract client

## Contract

`takos-agent` は remote tool backend を内包しません。tool 実行は次の 2 層です。

Workerのtool catalogは`side_effects` / `risk_level`をwrapperまで保持します。明示的なlow-risk read-only toolだけを
parallel実行し、未分類・high-risk・side-effecting toolはprovider順に直列実行します。外部MCPのannotationだけで
read-onlyへ昇格させません。

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

current imageのaccepted `/start` responseは`runtimeProtocolVersion: 2`を返します。executor hostは予約時点ではtokenをversionless
(rolling v1-compatible)にし、exact tokenを受け取ったresponseがv2を明示した場合だけそのtokenをv2へ昇格します。v2 tokenはatomic
`complete-run`を必須とします。rollback用に、`complete-run` endpointが明確な404/405の場合だけnew wrapperがlegacy
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

Takos Workerはrun bootstrap / context / config / conversation history / memory activation / tool catalog /
tool execute / engine checkpoint save・load / heartbeat / status update / run eventを公開します。
`run-config.systemPrompt` は必須のWorker-owned policyで、空ならwrapperはlocal copyへfallbackせずrunを失敗させます。
`run-bootstrap` は `spaceId` を必須 context とし、Capsule/app経由で起動されたrunでは移行中のwire field
`installationId` と `runtimeNamespace` を任意で返せます。`Installation`をcurrent product entityとして再導入しません。
`takos-agent`はAccounts ledgerやCapsule lifecycleを所有しません。engineは
`ExecutionProfile::ExternalContext`を明示し、local ingest / activation / distillation / session overflowを通さないbounded model/tool
loopだけを使います。engine checkpointのdurable authorityはWorkerのRun ledgerで、container diskをrecovery authorityにしません。
idempotent tool nodeはresumeできますが、`uncertain` side effectはoperation ledgerからfatal reasonを復元し、直前のRunning
checkpointをreasonless terminal stateで上書きせず再実行を防ぎます。provider-neutralなidempotency contractがないmodel nodeも
自動再発行せずfail closedします。
checkpoint protocol v2はfatal responseを交渉し、rolling中のv1 wrapperには既存mapperが理解するcanonical RPC errorを返します。
`spaceId` / `installationId`をdurable filesystem namespaceとして使いません。

`/api/internal/v1/agent-control/run-config` の budget は `maxGraphSteps` / `maxToolRounds`
を正本の field name として読みます。未設定時は engine default (`64` / `8`) を使います。
snake_case alias、旧 `maxIterations` / `rateLimit`、tool catalog、embedding credential は
current run-config contract ではありません。

Durable semantic retrievalはTakos Workerがconversation historyを組み立てる際に実行します。production wrapperの
external-context profileはengine-local embedding / memory repositoryへturnを複製せず、消えるper-container indexを第二のmemory
authorityにしません。memory-aware engine profileとdeterministic hash embedderはlibrary/test supportとして残します。

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

release前は`containers/agent/engine-source.json`のpin、sibling checkoutのHEAD/clean state、wrapper compatibilityを
一体で検証します。未commit engine差分を古いSHAで表現しません。

```sh
bun run validate:agent-engine-source
```

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
  - Takos Worker の remote catalog が正本
  - `CompositeToolExecutor::exposed_tools()` は remote tools のみを返し、tool
    実行も control RPC を通します
- skill context
  - Rust はTakos Workerから受け取ったavailable managed/custom skill instructionsを
    structured system contextとしてrun promptへ渡します
  - `skill_list` / `skill_get` / CRUD は remote tool として実行し、Rust 側で
    同名 call を intercept しません

container imageにはmanaged skill snapshotを持ちません。tool/skillの追加・削除・annotations・認可はTakos Worker側の
catalogを正本として扱います。
