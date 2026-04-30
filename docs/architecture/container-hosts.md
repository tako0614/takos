# Container host RPC

Container host RPC は runtime-service container と control-plane の間を仲介
する **Control RPC + Proxy** layer。process role としては runtime host
(`takos-runtime-service` container を扱う) と executor host (agent run の
container を扱う) の 2 種類があり、どちらも Deployment lifecycle の
provider operation (apply 側) で起動する container と control plane の
`Deployment.desired.activation_envelope` から導出される route projection を
仲介する。

ソース: `packages/control/src/runtime/container-hosts/`

## 全体像

```
control-plane main / background process role (kernel)
  │  ① POST /dispatch  (run start)
  ▼
executor host process role
  │  ② container.dispatchStart(payload)
  ▼
Executor container (tier 1/2/3 で takos-agent を実行)
  │  ③ POST /rpc/control/*  (RPC into kernel)
  ▼
executor host process role (proxy / forward)
  │  ④ internal control binding fetch
  ▼
control-plane main /internal/executor-rpc/*
  │  ⑤ DB / queue / billing / memory-graph 等
  ▼
provider-side materialization (DB / vector index / queue / run-notifier)
```

runtime host process role も同じ pattern で、container 内の Deno
runtime-service に対する proxy として動く。

このページで扱う `/rpc/control/*`, `/forward/*` は **internal RPC contract**
であり、public API の common error envelope や retry contract をそのまま
適用しない。public API に公開する必要がある場合は edge で別 contract に
変換する。

## Tier 構成 (executor)

executor host process は agent run の負荷分類で 3 つの tier に container class
を分割する。tier 1 は常時 warm な軽量 agent、tier 2 は一般的な agent run、tier
3 は max memory を確保した custom load 向け。

dispatch payload に `tier?: 1 | 2 | 3` または `executorTier?: 1 | 2 | 3`
を含めると、`resolveContainerNamespace` (`executor-utils.ts`) が指定 tier の
namespace を選択する。指定 tier の binding が無ければ tier 1 へ fallback する。

tier 未指定の `/dispatch` は固定の default tier ではなく executor pool を使う。
まず warm tier 1 pool (`EXECUTOR_TIER1_WARM_POOL_SIZE`,
`EXECUTOR_TIER1_MAX_CONCURRENT_RUNS`) の空き slot を探し、空きがなければ
configured tier 3 pool (`EXECUTOR_TIER3_POOL_SIZE`,
`EXECUTOR_TIER3_MAX_CONCURRENT_RUNS`) の最も空いている slot に spill する。
tier 2 は automatic spill には使わず、payload で明示指定されたときだけ使う。

各 tier の sleepAfter / max instances / class 名など backend-specific な数値は
本ページ末尾の collapsible 節を参照。

## 認証

control plane main process の内部 call に使われる header は **2 つの別名** に
分離されている。混同しないこと:

1. **`X-Takos-Internal-Marker: "1"`** — edge auth middleware が読む sentinel。
   runtime host process が `/forward/cli-proxy/*` / `/forward/heartbeat/*` を
   internal binding 経由で kernel に渡す際に付ける。値 `"1"` は単なる in/out
   flag で secret ではない。
2. **`X-Takos-Internal: <secret>`** — executor proxy API の shared secret。
   `EXECUTOR_PROXY_SECRET` env var と constant-time 比較される。executor host
   process が control binding 経由で kernel の `/internal/executor-rpc/*`
   を呼ぶ際に付ける。

両 header は **同じ control-plane main process に到達する別経路** の認証に
使う。marker と shared secret は別名にしてあり、sentinel 値 `"1"` を secret と
取り違えないように攻撃面を分離してある。

container 自身が control RPC を呼ぶ際の auth は **proxy token**。
`dispatchStart` 時に `executor-proxy-config.ts buildAgentExecutorProxyConfig`
が生成し、container env vars (`AGENT_EXECUTOR_PROXY_TOKEN`) として渡される。
executor host 側では proxy token は host storage の `proxyTokens` map に保存
され、token → `{runId, serviceId, capability: 'control'}` を解決する。

::: tip Token lifetime proxy token は host process の storage `proxyTokens`
map に保存される。executor host の control token は terminal status update /
fail / reset の成功応答後に revoke される。runtime host の session proxy token
は 24h TTL を持ち、`/session/destroy` の成功後に該当 session の token を
revoke する。
:::

`X-Takos-Internal-Marker` / `X-Takos-Internal` header の具体的な edge auth
middleware や detect path、`EXECUTOR_PROXY_SECRET` の wiring 詳細は public
contract 側 [API reference](/reference/api) を参照。tracked reference Workers
backend での実装詳細は本ページ末尾の collapsible 節を参照。

## Control RPC endpoint matrix

`/rpc/control/*` は kernel 側の `/internal/executor-rpc/*` に 1:1 で forward
される (`executor-utils.ts CONTROL_RPC_PATH_MAP`)。production は すべて
`executor-proxy-api.ts createExecutorProxyRouter()` で受ける。

| `/rpc/control/...`      | 用途                                                 |
| ----------------------- | ---------------------------------------------------- |
| `heartbeat`             | run の lease 維持 (~15s 間隔)                        |
| `run-status`            | run の現在 status を取得                             |
| `run-record`            | run record を更新                                    |
| `run-bootstrap`         | run の初期 context (spaceId / threadId / sessionId)  |
| `run-config`            | agent type の system prompt + tools + max iterations |
| `run-fail`              | run を failed としてマーク (lease 保持時のみ)        |
| `run-reset`             | run を queued に戻す (失敗 retry)                    |
| `run-context`           | conversation に注入する追加 context                  |
| `no-llm-complete`       | LLM を使わずに完了マーク                             |
| `current-session`       | active session id 取得                               |
| `is-cancelled`          | cancel フラグ check                                  |
| `conversation-history`  | LLM input 用の message history                       |
| `skill-runtime-context` | 有効 skill の runtime context                        |
| `skill-catalog`         | 利用可能 skill 一覧                                  |
| `skill-plan`            | skill resolution plan                                |
| `memory-activation`     | memory graph activation bundles                      |
| `memory-finalize`       | memory claims / evidence の persist                  |
| `add-message`           | conversation に message を追記                       |
| `update-run-status`     | run status を遷移                                    |
| `tool-catalog`          | run の tool catalog                                  |
| `tool-execute`          | tool を kernel-side で実行                           |
| `tool-cleanup`          | tool 実行後のクリーンアップ                          |
| `run-event`             | SSE / WS に event を emit                            |
| `billing-run-usage`     | run 終了時の usage を recordUsage                    |
| `api-keys`              | OpenAI / Anthropic / Google の API キー              |

heartbeat は takos-agent (`agent/src/main.rs`) が **15 秒間隔** で emit
する。`STALE_WORKER_THRESHOLD_MS = 5 min` (`runner-constants.ts`) で 20 missed
beats まで許容。

::: warning Idempotency control RPC は endpoint ごとに retry safety が異なる。
`run-event` は run id + type + sequence を dedupe key として扱う。executor host
isolate の 1h 短期 cache は best-effort で、host restart や cache expiry 後の
durable authority ではない。control-plane DB の `run_events` path では
`event_key` unique index、run notifier では storage-backed dedupe key が重複
emit 抑止の本体になる。`heartbeat` は timestamp update なので実質 idempotent。
`add-message` は任意の `idempotencyKey` を受け取り、同一 thread + 同一 key
を同じ replay として扱う。takos-agent の assistant message は run id + content
hash を key にする。`update-run-status` は明示的な idempotency key
はないが、同一 terminal status / usage / output / error の replay では
`completed_at` を更新しない。caller は retry する endpoint ごとの contract
を前提に扱う。
:::

## エラー envelope

container host endpoint は **internal RPC** なので、public API common envelope
(`{ error: { code, message } }`) とは別 contract である。現状の host 側は flat
な `{ error: "string" }` shape を返す
(`shared/utils/http-response.ts
errorJsonResponse`)。

これは takos-agent / kernel 間の transport に寄せた意図的な設計で、public api.md
の error code table はこの層には適用しない。

## デプロイ

container host process は backend-specific な host worker / process としてマウント
される。tracked reference Workers backend での具体的な host 配置 / container
class 名 / 配備設定は本ページ末尾の collapsible 節を参照。

container host process role と main control-plane process は同じ
`EXECUTOR_PROXY_SECRET` を共有する。executor host は DB / object-store binding
を持たず、必要な control RPC は internal control binding 経由で main process
に forward する。LLM backend API key は通常 `/rpc/control/api-keys` 経由で
main process から run ごとに取得するが、host 側でも optional fallback secret
として `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY` を設定可能。
設定された非空の provider key は `executor-proxy-config.ts` により container
env vars に渡される。

## 関連ドキュメント

- [Runtime Service](/architecture/runtime-service) — runtime host 内で
  動く Deno HTTP server
- [Control plane](/architecture/control-plane) — kernel 側の queue / cron
  全体図
- [Threads and Runs](/platform/threads-and-runs) — agent run lifecycle の user
  視点

## Workers backend reference materialization

::: details tracked reference Workers backend の実装詳細

> このセクションは Cloudflare Workers backend に固有の materialization
> detail。Core 用語との対応は
> [Glossary § Workers backend implementation note](/reference/glossary#workers-backend-implementation-note)
> を参照。

tracked reference Workers backend では container host process role は
Cloudflare Container DO sidecar を持つ専用 worker として動く。

### Worker name と Container DO

| process role        | worker 名             | container class                   |
| ------------------- | --------------------- | --------------------------------- |
| executor host       | `takos-executor-host` | `ExecutorContainerTier1/2/3`      |
| runtime host        | `takos-runtime-host`  | `takos-runtime-service` container |

### Tier 構成 (Cloudflare 数値)

`takos-executor-host` は 3 つの tier の Container DO class を export する:

| tier | class                    | sleepAfter | max instances | 用途                         |
| ---- | ------------------------ | ---------- | ------------- | ---------------------------- |
| 1    | `ExecutorContainerTier1` | `10m`      | ~20           | lite (常時 warm、軽量 agent) |
| 2    | `ExecutorContainerTier2` | `5m`       | ~200          | basic (一般的な agent run)   |
| 3    | `ExecutorContainerTier3` | `3m`       | ~25           | custom (max memory 12GiB)    |

### Wrangler 配置

| worker                | wrangler 設定                                       | container class                   |
| --------------------- | --------------------------------------------------- | --------------------------------- |
| `takos-executor-host` | `takos/app/apps/control/wrangler.executor.toml`     | `ExecutorContainerTier1/2/3`      |
| `takos-runtime-host`  | `takos/app/apps/control/wrangler.runtime-host.toml` | `takos-runtime-service` container |

worker ごとの主な service binding は次のとおり。

- `takos-executor-host`: `TAKOS_CONTROL`
- `takos-runtime-host`: `TAKOS_WEB`

### Auth header の Cloudflare 接続

- `X-Takos-Internal-Marker: "1"`: `takos-runtime-host` worker が
  `/forward/cli-proxy/*` / `/forward/heartbeat/*` を `env.TAKOS_WEB.fetch(...)`
  で kernel に渡す際に付ける。kernel 側 (`server/middleware/auth.ts` +
  `server/routes/sessions/auth.ts`) は「このリクエストは service binding 経由で
  runtime-host 内から来た」と認識し、`X-Takos-Session-Id` / `X-Takos-Space-Id`
  header で container session を解決する。
- `X-Takos-Internal: <secret>`: `takos-executor-host` worker が `TAKOS_CONTROL`
  service binding 経由で kernel の `/internal/executor-rpc/*` を呼ぶ際に
  `EXECUTOR_PROXY_SECRET` の値を付ける (constant-time 比較)。

container は自身の control RPC では shared secret を知らず、runtime host を
介した forward は marker を使う。container → executor host → kernel の
dispatch path では executor host の `forwardToControlPlane` が secret を自前で
付与する。

### Provider key fallback

`takos-executor-host` と main `takos` worker は同じ `EXECUTOR_PROXY_SECRET`
を持つ。`wrangler.executor.toml` では `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` /
`GOOGLE_API_KEY` を optional fallback secret として設定できる。

:::
