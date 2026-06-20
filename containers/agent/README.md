# takos-agent

> Internal service of [Takos](../README.md). 公開 product overview と Quickstart
> は親 README を参照してください。

`takos-agent` は Takos の agent execution service です。`takos-agent-engine` を
Rust library として利用し、agent loop、managed skills の Rust runtime copy、
prompt construction、tool bridge を service process 内で扱います。Takosumi-owned
agent-control RPC と接続します。

このディレクトリの正本責務は次です。

- agent loop orchestration
- memory substrate と local memory tools
- managed skill 定義
- skill catalog 合成と selection
- skill prompt / system prompt 構築
- model runner wiring
- Takosumi control plane との agent-control RPC client
- remote tool 実行の bridge

## 境界

Takos の agent architecture では、「all Rust」にする対象を container
の内側に限定します。

Rust container が正本として持つもの:

- 推論ループ
- memory / context assembly
- local tool execution internals
- skill activation
- prompt construction
- model runner wiring

Takosumi / control plane 側に残すもの:

- run queue と run lifecycle 管理
- DB / billing / auth / space state
- remote tool の実体
- custom skill の CRUD と永続化
- agent container を起動する executor pool host process

この分離により、agent の思考と実行本体は Rust で固定しつつ、Takos product の
stateful backend と tool backend は Takos app / Takosumi kernel control plane 側で運用できます。

## 主要モジュール

- `src/main.rs`
  - `/start` entrypoint。Takosumi-owned agent-control RPC から bootstrap して agent loop を起動
- `src/engine_support.rs`
  - agent engine support wiring
- `src/skills.rs`
  - managed/custom skill catalog 合成、selection、local skill tools
- `src/managed_skills.rs`
  - managed skill の Rust runtime copy
- `src/prompts.rs`
  - agent type ごとの system prompt 正本
- `src/tool_bridge.rs`
  - local memory/skill tools と remote tool catalog の合成
- `src/control_rpc.rs`
  - Takosumi-owned agent-control RPC contract client

## Contract

`takos-agent` は remote tool backend を内包しません。tool 実行は次の 2 層です。

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
です。tiered executor pool では tier1 に `4`、tier3 に `32`
を注入します。同じ `runId` の duplicate `/start` は accepted として扱い、別の
run が上限を超えた場合は `503 At capacity` を返します。

agent-control RPC の canonical path は Takosumi contract export
`takosumi-contract` の
`/api/internal/v1/agent-control/*` です。`takos-agent` はこの path family を
一次 surface として呼びます。他の path family は current `takos-agent` の RPC
surface ではありません。

- `TAKOS_AGENT_CONTROL_RPC_BASE_URL` / `TAKOS_AGENT_CONTROL_RPC_TOKEN`
  - `/api/internal/v1/agent-control/*` 用の明示的な設定名
- `/start` payload の `controlRpcBaseUrl` / `controlRpcToken`
  - executor pool host から渡される run-local RPC 設定
- `TAKOSUMI_INTERNAL_URL`
  - tenant/platform Takosumi internal API 用。agent-control RPC の bearer-token transport
    base としては使わない

Takosumi 側の contract export では、run bootstrap / context / config / tool catalog /
tool execute / heartbeat / status update / run event などの surface を明示します。
`run-bootstrap` は `spaceId` を必須 context とし、shared-cell / Installation
経由で起動された run では `installationId` と `runtimeNamespace` を任意で返せます。
`takos-agent` は Accounts ledger や Installation runtime mode を所有せず、この context を
消費して local memory store を `spaces/<spaceId>/installations/<installationId>`
に隔離します。`installationId` が無い run は space-scoped local run として
`spaces/<spaceId>` を使います。

`/api/internal/v1/agent-control/run-config` の budget は `maxGraphSteps` / `maxToolRounds`
を正本の field name として読みます。snake_case alias は current contract ではありません。

memory embedding backend は未設定時に smoke/test 用の Rust hash embedder を使います。
`/api/internal/v1/agent-control/run-config` または env で `embeddingProvider` に `openai` /
`openai-compatible` を指定すると、`takos-agent-engine` の
`OpenAiCompatibleEmbedder` を使います。設定名は `embeddingModel` /
`embeddingBaseUrl` / `embeddingApiKey` / `embeddingDimensions` です。env は
`TAKOS_EMBEDDING_PROVIDER`、`TAKOS_EMBEDDING_MODEL`、
`TAKOS_EMBEDDING_BASE_URL`、`TAKOS_EMBEDDING_API_KEY`、
`TAKOS_EMBEDDING_DIMENSIONS` を優先します。API key は control plane の
`/api/internal/v1/agent-control/api-keys` の OpenAI-compatible key、最後に `OPENAI_API_KEY` も fallback
として使います。

Production では `TAKOS_EMBEDDING_PROVIDER=openai-compatible` または `openai` と、
`TAKOS_EMBEDDING_API_KEY` / `OPENAI_EMBEDDING_API_KEY` / control plane の
OpenAI key のいずれかを設定します。`TAKOS_EMBEDDING_MODEL` は未指定時
`text-embedding-3-small`、`TAKOS_EMBEDDING_BASE_URL` は OpenAI-compatible endpoint
を差し替える場合のみ、`TAKOS_EMBEDDING_DIMENSIONS` は provider が dimension 指定を
受ける場合のみ設定します。embedding provider が全く設定されていない場合、service は
WARN を出して Rust hash embedder に fallback します。これは smoke/test 用であり
production memory retrieval の backend として扱いません。

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
  - control plane の remote catalog が正本
  - `CompositeToolExecutor::exposed_tools()` は remote_tools のみを返し、model
    に渡す tool list も remote catalog を前提にします
- local runtime execution
  - `semantic_search_memory`
  - `graph_search_memory`
  - `provenance_lookup`
  - `timeline_search`
  - `skill_list`
  - `skill_get`
  - `skill_context`
  - `skill_catalog`
  - `skill_describe`
- remote
  - Takos control plane が catalog / execution を提供する tool 群

tool discovery は control plane の catalog を正としつつ、`skill_*` の実行は
Rust 側で local intercept します。`skill_list` / `skill_get` は custom skill
のみを返し、managed skill を含む合成 catalog は `skill_context` /
`skill_catalog` / `skill_describe` が返します。local memory tools と `skill_*`
は model-visible catalog に直接追加されるとは限らず、remote catalog の同名
call や local execution path を Rust container が intercept / execute します。
同名 tool がある場合に local execution が優先されるのは runtime dispatch
の話で、`exposed_tools()` が local tools を常に返すという意味ではありません。
