# AGENTS.md — takos-agent

`takos-agent` は Takos の **agent execution service** で、 Rust で書かれた `takos-agent-engine` library を service
process 内で利用し、 agent loop / memory substrate / managed skill / prompt construction / tool bridge を扱う。
Takosumi-owned agent-control RPC と接続する。

## 責務

### 持つ

- agent loop orchestration
- memory substrate と local memory tools
- managed skill 定義
- skill catalog 合成と selection
- skill prompt / system prompt 構築
- model runner wiring
- Takosumi control plane との agent-control RPC client
- remote tool 実行の bridge

### 持たない

- agent deployment lifecycle (Takosumi kernel の責務)
- identity / billing / OAuth (Takosumi Accounts の責務)
- agent code の Rust 内側を超える wrapping (それは takos-agent-engine の責務)

## 隣接 product との contract

- **Upstream library**: [`../../../takos-agent-engine`](../../../takos-agent-engine) (Rust agent engine library)
- **Upstream control plane**: Takosumi kernel agent-control RPC (manifest 経由で injection される)
- **Downstream consumer**: Takos product (`../../src/worker/`)
- 直接 `../../src/worker/` の implementation を import しない (service contract 経由)

## Substitutability

代替実装なし。 Takos product 固有の agent execution service。 Rust container 内側の primitive (推論ループ / memory /
local tool execution) は `takos-agent-engine` library の責務として substitutable (LLM provider / memory backend を
inject 可能)。

## Workflow

```bash
cd takos/containers/agent
cargo check
cargo test
cargo test --features mock-llm
cargo fmt --check
cargo clippy
```

## 関連 docs

- [`README.md`](README.md) — service responsibilities と境界
- [`../../../takos-agent-engine/README.md`](../../../takos-agent-engine/README.md) — engine library design
