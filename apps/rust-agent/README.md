# Rust Agent Container

`apps/rust-agent` は Takos の agent container 実装です。

このディレクトリの正本責務は次です。

- agent loop orchestration
- memory substrate と local memory tools
- official skill 定義
- skill catalog 合成と selection
- skill prompt / system prompt 構築
- model runner
- control plane との RPC client
- remote tool 実行の bridge

## 境界

Takos の agent architecture では、「all Rust」にする対象を container の内側に限定します。

Rust container が正本として持つもの:

- 推論ループ
- memory / context assembly
- local tool execution
- skill activation
- prompt construction

Workers / control plane 側に残すもの:

- run queue と run lifecycle 管理
- DB / billing / auth / workspace state
- remote tool の実体
- custom skill の CRUD と永続化
- executor-host / browser-host の host process

この分離により、agent の思考と実行本体は Rust で固定しつつ、Takos platform の stateful backend と tool backend は Workers/TS のまま運用できます。

## 主要モジュール

- `src/main.rs`
  - `/start` entrypoint。control RPC から bootstrap して agent loop を起動
- `src/engine_support.rs`
  - `takos-agent-engine` の dependency wiring
- `src/skills.rs`
  - official/custom skill catalog 合成、selection、local skill tools
- `src/official_skills.rs`
  - official skill の Rust 正本
- `src/prompts.rs`
  - agent type ごとの system prompt 正本
- `src/tool_bridge.rs`
  - local memory/skill tools と remote tool catalog の合成
- `src/control_rpc.rs`
  - control plane との RPC contract

## Contract

`rust-agent` は remote tool backend を内包しません。tool 実行は次の 2 層です。

- local
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

local tool と remote tool の優先順位は Rust container が持ち、同名なら local が優先されます。
