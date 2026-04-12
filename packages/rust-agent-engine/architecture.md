# takos-agent-engine architecture v0.3

## 1. 目的

`takos-agent-engine` は、Takos の agent loop を Rust で実装する library-first な runtime である。

この engine の役割は次の 4 点に集約される。

- session 履歴と長期 memory を単一基盤で扱う
- RawNode / AbstractNode の二層記憶を activation して context を再構成する
- node graph と checkpoint により agent loop を再開可能に実行する
- raw な出来事を構造化して provenance 付き graph memory に育てる

この文書は概念仕様ではなく、現在の Rust 実装の正本アーキテクチャを説明する。

## 2. 基本方針

### 2.1 library-first

公開入口は binary ではなく `lib.rs` である。標準入口は次の 2 層に分かれる。

- 低レベル: `ExecutionGraph` / `GraphRunner`
- 高レベル: `run_turn` / `run_turn_with_options` / `resume_loop` / `run_maintenance_pass`

demo wiring は `examples/` に置き、crate 本体は stateless core として保つ。

### 2.2 core は stateless

engine 本体は session state や memory state を内包しない。状態はすべて injected dependency 側に置く。

- node / abstract / timeline は `NodeRepository`
- embedding search は `VectorIndex`
- abstract relation graph は `GraphRepository`
- loop checkpoint は `LoopStateRepository`

したがって正確には「stateful agent system を動かす stateless runner」である。

### 2.3 append-friendly と idempotent persistence

RawNode は event log として追記し、AbstractNode は構造化済み知識として append する。再開時に二重書き込みを避けるため、side effect には `operation_key` を持たせる。

- user input persist は `loop:{loop_id}:user_input`
- tool result persist は `loop:{loop_id}:tool_round:{n}:tool:{i}:{name}`
- assistant output persist は `loop:{loop_id}:assistant_output`
- distillation persist は `loop:{loop_id}:abstract:primary`

## 3. 現在のシステム全体像

標準 agent は bounded multi-step graph として実装されている。

```text
ingest_user_input
  -> load_session_view
  -> build_activation_query
  -> activate_memory
  -> assemble_context
  -> run_model
    -> execute_tools
    -> build_followup_activation_query
    -> reactivate_memory
    -> reassemble_context
    -> run_model_after_tools
    -> (tool rounds remain ? execute_tools : persist_assistant_output)
  -> persist_assistant_output
  -> mark_session_overflow
  -> distill_current_loop
  -> finish
```

`run_turn` はこの default graph を実行する facade であり、custom graph を直接 `GraphRunner` で動かすこともできる。

## 4. ディレクトリ構成

```text
src/
  lib.rs
  config.rs
  error.rs
  ids.rs
  domain/
  engine/
    execution_graph.rs
    session_engine.rs
    context_assembler.rs
  memory/
  storage/
  model/
  tools/
examples/
  demo.rs
  object_demo.rs
  common/support.rs
```

`src/main.rs` は持たず、binary wiring は `examples/` に限定する。

## 5. ドメインモデル

### 5.1 RawNode

RawNode は生の発話、tool result、途中メモ、event を表す一次記録である。

- graph edge は持たない
- vector search の対象になる
- `distillation_state` と `overflow` を持つ
- idempotent persist 用に `operation_key` を持てる

RawNode は session の近傍履歴でもあり、長期 memory の生ログでもある。session と memory を別物として保存しない。

### 5.2 AbstractNode

AbstractNode は RawNode 群から蒸留された構造化 knowledge unit である。

- raw provenance を参照できる
- 他の abstract を参照できる
- graph fragment を持つ
- vector search と graph traversal の両方の対象になる
- `operation_key` により再開時の重複生成を防げる

### 5.3 LoopState

loop の一時状態と recovery 情報は `LoopState` に checkpoint される。主要フィールドは次の通り。

- `current_node`
- `iteration`
- `tool_rounds_completed`
- `model_invocations`
- `status`
- `last_completed_node`
- `last_effect_key`
- `recent_events`
- `activated_raw`
- `activated_abstract`
- `session_window`
- `pushed_out_raw`
- `tool_result_ids`
- `assistant_message`
- `state_json`

`state_json` には `ExecutionState` 全体を保存し、`resume_loop` はそこから graph 実行を再開する。

### 5.4 LoopStatus

loop status は次を持つ。

- `Running`
- `Paused`
- `Finished`
- `Cancelled`
- `TimedOut`
- `Failed`

## 6. storage 抽象

最低限の境界は次の 4 つである。

- `NodeRepository`
- `VectorIndex`
- `GraphRepository`
- `LoopStateRepository`

### 6.1 NodeRepository

`NodeRepository` は raw / abstract の正本であり、timeline・loop・session view と raw lifecycle patch を担当する。

重要 API:

- `insert_raw`
- `insert_abstract`
- `get_raw_by_operation_key`
- `get_abstract_by_operation_key`
- `recent_session_raw`
- `session_raw`
- `raw_for_loop`
- `timeline_raw`
- `update_raw_lifecycle`
- `undistilled_raw`

### 6.2 VectorIndex

`VectorIndex` は raw / abstract の embedding index を持つ。現在の production baseline は exact cosine search であり、ANN はまだ採用しない。

### 6.3 GraphRepository

`GraphRepository` は AbstractNode の relation graph を index し、predicate filter 付き traversal を提供する。

戻り値は node id だけではなく、`depth` と `via_predicate` を含む `GraphTraversalHit` である。

### 6.4 LoopStateRepository

checkpoint の保存・読込・削除を担当する。graph node の前後で checkpoint されるため、途中中断からの recovery が可能である。

## 7. backend 実装

現在の正式 backend は object backend のみである。in-memory 実装は test support に降格しており、crate の公開 concrete surface には含めない。

object backend は JSON object を正本にし、session・memory・embedding・graph・checkpoint を同じ root 配下に保存する。query path では directory scan に頼らず、session / loop / timeline / backlog / embedding manifest を materialized index として持つ。

- `store.json`
- `raw/{id}.json`
- `abstract/{id}.json`
- `embeddings/raw/{id}.json`
- `embeddings/abstract/{id}.json`
- `graph/{id}.json`
- `checkpoints/{session_id}--{loop_id}.json`
- `indexes/raw_operation/{encoded}.json`
- `indexes/abstract_operation/{encoded}.json`
- `indexes/session/{session_id}.json`
- `indexes/loop/{loop_id}.json`
- `indexes/timeline/raw.json`
- `indexes/backlog/undistilled_raw.json`
- `indexes/backlog/pushed_undistilled_raw.json`
- `indexes/vector/raw_embeddings.json`
- `indexes/vector/abstract_embeddings.json`

運用上重要な点:

- `operation_key` による idempotent lookup を持つ
- object backend は open 時に canonical object から index を再整列する
- `store.json` に `format_version` / `created_at` / `updated_at` / `last_index_rebuild_at` を持つ
- undistilled backlog と overflow backlog に index を持つ
- vector retrieval は deterministic ordering を行う

## 8. 実行モデル

### 8.1 ExecutionGraph / GraphRunner

`ExecutionGraph` は node と branch edge を持つ実行 graph である。`GraphRunner` は graph を 1 node ずつ進める。

node は `GraphNode` trait を実装する。

```rust
#[async_trait]
pub trait GraphNode: Send + Sync {
    fn id(&self) -> &'static str;
    fn runtime_class(&self) -> NodeRuntimeClass;
    async fn run(
        &self,
        state: &mut ExecutionState,
        config: &EngineConfig,
        deps: &EngineDeps,
        options: &ResolvedRunOptions,
    ) -> Result<NodeOutcome>;
}
```

`NodeOutcome` は `Continue` / `Branch` / `Finish` / `Pause` を持つ。

### 8.2 checkpoint / recovery

`GraphRunner` は side effect 境界の前で checkpoint し、loop が次の理由で止まっても再開できるようにする。

- cancellation
- timeout
- explicit pause
- process restart

`resume_loop(config, deps, session_id, loop_id, options)` は checkpoint から `ExecutionState` を復元し、直前 node から graph を継続する。

### 8.3 bounded runtime

無限 loop を防ぐため、実行は runtime budget を持つ。

- `max_graph_steps`
- `max_tool_rounds`
- `node_timeout_ms`
- `tool_timeout_ms`
- `distillation_timeout_ms`
- `maintenance_batch_size`

tool round は 1 回固定ではなく bounded multi-step である。`run_model` と `execute_tools` は条件付きで複数回往復できるが、`max_tool_rounds` を超えない。

### 8.4 cancellation-safe

`RunOptions` は `CancellationToken` と timeout override を受け取れる。`GraphRunner` は node runtime class ごとに timeout を適用する。

- `Standard`
- `ToolExecution`
- `Distillation`

timeout や cancellation は `LoopStatus::TimedOut` / `LoopStatus::Cancelled` として checkpoint に残す。

## 9. activation 設計

activation query は次の材料から作る。

- 現在の user message
- plan
- recent session
- 直前の tool result

embedding は `Embedder` trait で生成する。activation は Raw / Abstract を別検索し、config の target ratio に従って採用する。初期値は 1:1 である。

score には少なくとも次が入る。

- semantic similarity
- importance bias
- freshness / time decay
- overflow bonus

未蒸留かつ session から押し出された raw は閾値を緩めて再活性化しやすくする。

## 10. context assembly

context window は token budget として扱う。`ContextAssembler` は次を組み立てる。

- system prompt
- recent session bucket
- activated memory bucket
- tool bucket

同時に session window decision を返し、何を含めて何を押し出したかを `ExecutionState` に保存する。

押し出された raw で未蒸留のものは、後段の overflow marking で relaxed retrieval の対象になる。

## 11. model と tool

### 11.1 ModelRunner

model は `ModelRunner` trait 越しに使う。crate 本体は concrete model runner を公開せず、example と test support に deterministic toy 実装を置く。実 LLM backend は利用側が差し込む。

### 11.2 ToolExecutor

tool 実行は `ToolExecutor` trait 越しに行う。標準 graph では model が tool call を返したときだけ `ExecuteToolsNode` が走る。

tool result は次の性質を持つ。

- RawNode として永続化される
- JSON payload 全体を保持する
- `operation_key` により resume 後も重複しない
- follow-up activation query と reassembly に反映される

## 12. memory exploration tools

memory は自動活性化だけでなく、tool として能動探索できる。

提供する typed tool は次の通り。

- `semantic_search_memory`
- `graph_search_memory`
- `provenance_lookup`
- `timeline_search`

設計上の原則:

- raw/abstract の hit は deterministic ranking で返す
- graph traversal は predicate filter と stable order を持つ
- timeline search は global / session-scoped の両方を扱う
- string ではなく struct で返し、LLM 直前で整形する

## 13. distillation 設計

distillation は「圧縮」ではなく「構造化」である。

入力:

- current loop の RawNode 群
- activated AbstractNode 参照

出力:

- 新規 AbstractNode
- raw lifecycle update

crate 本体は `Distiller` trait を公開し、example/test support に deterministic baseline 実装を置く。

- session / loop entity を立てる
- raw ノードとの relation を張る
- tool result relation を張る
- activated abstract に `informed_by` relation を張る
- provenance raw ids を relation に埋める

distillation 成功後は raw を `Distilled` に更新し、overflow bias を落とす。

## 14. maintenance pass

`run_turn` は current loop の distillation を同期で行う。一方、session から押し出された backlog raw は `run_maintenance_pass` で後処理する。

maintenance の挙動:

- undistilled かつ pushed-out raw を取得
- `(session_id, loop_id)` 単位で group 化
- loop ごとに distill
- 新規 abstract を保存
- raw lifecycle を更新

これにより session context からあふれた raw も後から graph memory に昇格できる。

## 15. 設定

設定は `EngineConfig` に集約し、`toml` から読める。

主要セクション:

- `system_prompt`
- `memory`
- `context_budget`
- `tools`
- `runtime`

runtime では step budget、tool budget、timeout、maintenance batch size を管理する。

```toml
system_prompt = "You are the Rust-based Takos agent engine."

[memory.activation.target_ratio]
raw = 1
abstract = 1

[context_budget]
total_tokens = 64000
session_ratio = 0.5
memory_ratio = 0.5

[runtime]
max_graph_steps = 64
max_tool_rounds = 8
node_timeout_ms = 10000
tool_timeout_ms = 30000
distillation_timeout_ms = 15000
maintenance_batch_size = 32
```

## 16. エラーと観測性

エラーは少なくとも次に分ける。

- configuration
- storage
- model
- tool
- timeout
- cancellation / terminated loop

runtime は `tracing` span を使い、少なくとも次を追えるようにする。

- `session_id`
- `loop_id`
- current node
- graph steps
- tool rounds
- maintenance batch

## 17. テスト戦略

現在のテストは deterministic backend を前提に組む。

- config parse / validation
- scoring
- context budget
- graph branching / timeout / resume
- idempotent persistence
- object restart continuity
- maintenance pass と distillation lifecycle

実 model に依存しないため、CI で安定して再現できることを優先する。

## 18. 現時点の到達点と未実装

到達点:

- library-first な stateless core
- graph runtime と checkpoint / resume
- bounded multi-step tool loop
- idempotent persistence
- RawNode / AbstractNode 二層 memory
- overflow-aware retrieval
- deterministic distillation
- object-backed 永続 backend

まだ未実装:

- 実 LLM / 実 embedding backend の同梱
- ANN vector index
- 分散 scheduler
- planner / subgoal 専用 graph preset
- multi-agent memory federation

## 19. 一文で要約

`takos-agent-engine` は、session と長期 memory を同一 substrate 上で扱い、RawNode / AbstractNode の二層記憶を activation しながら、checkpoint 可能な graph runtime で長期継続実行する Rust agent engine である。
