# Agent Runtime

::: tip Status
このページは current implementation の agent runtime 境界を説明します。Takos は control plane 全体を Rust に寄せる方針ではなく、container 内の agent 本体を Rust の正本にする方針です。
:::

## 方針

Takos の agent 系で `all Rust` と呼ぶ対象は、`rust-agent` container の内側です。

Rust が正本として持つもの:

- agent loop orchestration
- memory substrate
- context assembly
- official skill definitions
- skill catalog 合成と activation
- prompt construction
- local memory tools
- local skill tools
- model runner

Workers / control plane 側に残すもの:

- run queue と run lifecycle 管理
- auth / billing / workspace / thread / run state
- remote tool catalog と tool 実行実体
- custom skill の CRUD と永続化
- executor-host / browser-host の host process

この分離が current canonical architecture です。

## 実行構成

```text
control-web / control-worker
  -> executor-host
     -> rust-agent container
        -> takos-agent-engine
        -> local memory tools
        -> local skill tools
        -> remote tool bridge
             -> control RPC
             -> Workers / platform tools
```

`rust-agent` は container の inside loop を責務として持ち、platform state は control plane に委譲します。

## なぜこの分離か

- agent の思考ループは Rust で型安全に固定したい
- tool backend と platform state は Takos 本体の Workers/DB と密結合している
- custom skill や remote tool を全部 Rust に移すと、platform の変更速度を落とす
- 一方で container 内の loop を Rust にすれば、agent 自体の信頼性と再現性は高められる

つまり、Takos における Rust 化の目的は「platform を全部書き換えること」ではなく、「agent container の本体を Rust の正本にすること」です。

## Local と Remote の境界

`rust-agent` は local tool と remote tool を明示的に分けます。

local:

- `semantic_search_memory`
- `graph_search_memory`
- `provenance_lookup`
- `timeline_search`
- `skill_list`
- `skill_get`
- `skill_context`
- `skill_catalog`
- `skill_describe`

remote:

- repo / file / deploy / runtime / browser / MCP / workspace などの platform tool

同名の tool がある場合は Rust container の local 実装が優先です。  
remote tool の実体は control plane が持ち、Rust 側は catalog と execution を RPC で扱います。

## Skill の正本

official skill:

- Rust 側が正本
- locale ごとの文言、instructions、execution contract を `apps/rust-agent` に保持

custom skill:

- control plane DB が正本
- Rust 側は runtime ごとに catalog に取り込み、selection と prompt 化を行う

このため、「agent の振る舞い」は Rust 正本ですが、「workspace 管理データ」は control plane 正本のままです。

## 実装上の source of truth

- agent core: `packages/rust-agent-engine`
- container app: `apps/rust-agent`
- control RPC contract: `packages/control/src/runtime/container-hosts/executor-control-rpc.ts`

`apps/rust-agent` は thin wrapper ではなく、Takos agent container の canonical app です。
