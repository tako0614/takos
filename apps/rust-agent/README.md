# Rust Agent Container

`apps/rust-agent` は Takos monorepo 内の agent runtime integration です。agent
loop、managed skills の Rust runtime copy、prompt construction、tool bridge
をこの app 内で扱い、TS control-plane 側の skill API / source と RPC
で接続します。

このディレクトリの正本責務は次です。

- agent loop orchestration
- memory substrate と local memory tools
- managed skill 定義
- skill catalog 合成と selection
- skill prompt / system prompt 構築
- model runner wiring
- control plane との RPC client
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

Workers / control plane 側に残すもの:

- run queue と run lifecycle 管理
- DB / billing / auth / space state
- remote tool の実体
- custom skill の CRUD と永続化
- executor-host の host process

この分離により、agent の思考と実行本体は Rust で固定しつつ、Takos platform の
stateful backend と tool backend は Workers/TS のまま運用できます。

## 主要モジュール

- `src/main.rs`
  - `/start` entrypoint。control RPC から bootstrap して agent loop を起動
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
  - control plane との RPC contract

## Contract

`rust-agent` は remote tool backend を内包しません。tool 実行は次の 2 層です。

`/start` は executor-host から渡される `executorTier` /
`executorContainerId` を受け取り、全 Control RPC に
`X-Takos-Executor-Tier` / `X-Takos-Executor-Container-Id` として転送します。
これにより tiered executor pool の token verify / heartbeat / token revoke は
Rust container でも同じ contract で動きます。

同時実行上限は `MAX_CONCURRENT_RUNS` で指定します。未設定時の既定値は `5`
です。executor-host の tiered pool では tier1 に `4`、tier3 に `32`
を注入します。同じ `runId` の duplicate `/start` は accepted として扱い、別の
run が上限を超えた場合は `503 At capacity` を返します。

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

tool discovery は control plane の catalog を正としつつ、`skill_list` /
`skill_get` / `skill_context` / `skill_catalog` / `skill_describe` は Rust 側で
local intercept して、managed skill と custom skill の合成結果を返します。local
memory tools と `skill_*` は model-visible catalog に直接追加されるとは限らず、
remote catalog の同名 call や local execution path を Rust container が
intercept / execute します。`skill_*` は managed / custom skill synthesis の
local intercept です。同名 tool がある場合に local execution が優先されるのは
runtime dispatch の話であって、`exposed_tools()` が local tools を常に返す
という意味ではありません。
