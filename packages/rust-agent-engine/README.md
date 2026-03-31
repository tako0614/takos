# takos-agent-engine

Takos の agent engine を Rust で実装する standalone repository です。

現在は library-first の単一 crate 構成で、公開面は 2 層です。

- `run_turn` / `run_turn_with_options` / `resume_loop` / `run_maintenance_pass`: 標準の Takos agent preset
- `ExecutionGraph` / `GraphRunner`: node 分割された graph runtime

session と memory は同じ storage substrate 上で扱い、状態は library 内ではなく injected backend に保持します。`RawNode` と `AbstractNode` の二層 memory、context budget による session/memory 配分、overflow-aware retrieval、checkpoint/resume、bounded multi-step tool loop、object-backed 永続化と idempotent persistence を備えています。object backend は JSON object を正本にしつつ、session / loop / timeline / backlog / embedding manifest を materialized index として持ち、`store.json` で format version と rebuild metadata を管理します。open 時には canonical object から index を再整列してから serving します。

crate 本体は vendor-neutral な trait と runtime core だけを持ちます。demo 用の token estimator / embedder / model runner / distiller は `examples/common/support.rs` と test support に閉じ込めています。

## Commands

```bash
cargo build
cargo test
cargo clippy --all-targets -- -D warnings
cargo run --example demo
cargo run --example object_demo
```
