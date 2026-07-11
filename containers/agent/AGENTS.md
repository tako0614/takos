# AGENTS.md — takos-agent

`takos-agent` は Takos の **run-scoped agent execution service** で、 Rust の `takos-agent-engine` library を使って
bounded agent loop / structured model transcript / Worker提供contextのmodel request化 / tool bridge を扱う。Takos Worker が所有する
agent-control RPC と接続し、durable Thread / memory / skill / tool policy は Workerを正本にする。

## 責務

### 持つ

- agent loop orchestration
- external-context lean graph とengine checkpointの生成・resume (durable保存・lease authorityはWorker)
- Workerから渡されたcanonical history / memory activationのstructured model入力化
- Worker提供のsystem prompt / skill contextをmodel requestへ反映
- model runner wiring
- Takos Workerとのagent-control RPC client
- remote tool 実行の bridge

### 持たない

- agent deployment lifecycle (Takosumi kernel の責務)
- identity / billing / OAuth (Takosumi Accounts の責務)
- durable Thread / memory / skill catalog / tool authorization (Takos Worker の責務)
- system prompt policy のlocal fallback / duplicate copy (Takos Worker の責務)
- agent code の Rust 内側を超える wrapping (それは takos-agent-engine の責務)

## 隣接 product との contract

- **Upstream library**: [`../../../takos-agent-engine`](../../../takos-agent-engine) (Rust agent engine library)
- **Upstream product control**: Takos Worker agent-control RPC (`src/worker/runtime/container-hosts`)
- **Deployment authority**: Takosumi Capsule / ContainerService lifecycle
- **Downstream consumer**: Takos product (`../../src/worker/`)
- 直接 `../../src/worker/` の implementation を import しない (service contract 経由)

## Substitutability

代替実装なし。 Takos product 固有の agent execution service。 Rust container 内側の推論ループは
`takos-agent-engine` libraryの`ExecutionProfile::ExternalContext`を使う。memory-aware defaultとmemory backend inject点は
別consumer向けlibrary primitiveで、Takos wrapperの第二のmemory authorityにしない。

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
