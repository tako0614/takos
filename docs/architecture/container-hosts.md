# Container host RPC

`takos-runtime-host`, `takos-executor-host` は Cloudflare Container DO sidecar
を持つ専用 worker で、コンテナ内のプロセスと control-plane の間を仲介する
**Control RPC + Proxy** layer。

ソース: `packages/control/src/runtime/container-hosts/`

## 全体像

```
takos-worker / takos (kernel)
  │  ① POST /dispatch  (run start)
  ▼
takos-executor-host  (Container DO host)
  │  ② container.dispatchStart(payload)
  ▼
ExecutorContainerTier1/2/3  (CF Container DO with rust-agent inside)
  │  ③ POST /rpc/control/*  (RPC into kernel)
  ▼
takos-executor-host  (proxy / forward)
  │  ④ TAKOS_CONTROL.fetch  (service binding)
  ▼
takos /internal/executor-rpc/*
  │  ⑤ DB / queue / billing / memory-graph 等
  ▼
D1 / Vectorize / Queues / Run-notifier DO
```

`takos-runtime-host` も同じ pattern で、container 内の Deno runtime-service
に対する proxy として動く。

このページで扱う `/rpc/control/*`, `/forward/*` は **internal RPC contract**
であり、public API の common error envelope や retry contract をそのまま
適用しない。public API に公開する必要がある場合は edge で別 contract に
変換する。

## Tier 構成 (executor)

`takos-executor-host` は 3 つの tier の Container DO class を export する:

| tier | class                    | sleepAfter | max instances | 用途                         |
| ---- | ------------------------ | ---------- | ------------- | ---------------------------- |
| 1    | `ExecutorContainerTier1` | `10m`      | ~20           | lite (常時 warm、軽量 agent) |
| 2    | `ExecutorContainerTier2` | `5m`       | ~200          | basic (一般的な agent run)   |
| 3    | `ExecutorContainerTier3` | `3m`       | ~25           | custom (max memory 12GiB)    |

dispatch payload に `tier?: 1 | 2 | 3` (default 1) を含めると、
`resolveContainerNamespace` (`executor-utils.ts`) が namespace を選択する。
fallback: 上位 tier の binding が無ければ tier 1 へ。

## 認証

`takos` worker の内部 call に使われる header は **2 つの別名** に分離 されている
(Round 11 MEDIUM #11 fix)。混同しないこと:

1. **`X-Takos-Internal-Marker: "1"`** — edge auth middleware
   (`server/middleware/auth.ts` + `server/routes/sessions/auth.ts`) が読む
   sentinel。`takos-runtime-host` worker が `/forward/cli-proxy/*` /
   `/forward/heartbeat/*` を `env.TAKOS_WEB.fetch(...)` で kernel に渡す際に
   付ける。kernel 側では「このリクエストは service binding 経由で runtime-host
   内から来た」と認識し、`X-Takos-Session-Id` / `X-Takos-Space-Id` header で
   container session を解決する。値 `"1"` は単なる in/out flag で secret
   ではない
2. **`X-Takos-Internal: <secret>`** — executor proxy API
   (`runtime/executor-proxy-api.ts`) の shared secret。`EXECUTOR_PROXY_SECRET`
   env var と constant-time 比較される。`takos-executor-host` worker が
   `TAKOS_CONTROL` service binding 経由で kernel の `/internal/executor-rpc/*`
   を呼ぶ際に付ける

両 header は **同じ worker (`takos`) に到達する別経路** の認証に使う。marker と
shared secret は別名にしてあり、sentinel 値 `"1"` を secret と
取り違えないように攻撃面を分離してある。

container は自身の control RPC (runtime-service 内) では (2) の secret を
知らず、runtime-host を介した forward は (1) の marker を使う。container →
executor-host → kernel の dispatch path では executor-host の
`forwardToControlPlane` が (2) の secret を自前で付与する。

container 自身が control RPC を呼ぶ際の auth は **proxy token** で、
`dispatchStart` 時に `executor-proxy-config.ts buildAgentExecutorProxyConfig`
が生成 し、container env vars (`AGENT_EXECUTOR_PROXY_TOKEN`) として渡される。
executor-host 側では proxy token は DO storage の `proxyTokens` map に保存され、
token → `{runId, serviceId, capability: 'control'}` を解決する。

::: tip Token lifetime proxy token は host 側 DO storage の `proxyTokens` map に
保存される。executor-host の control token は terminal status update / fail /
reset の成功応答後に revoke される。runtime-host の session proxy token は 24h
TTL を持ち、`/session/destroy` の成功後に該当 session の token を revoke する。
:::

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

heartbeat は rust-agent (`apps/rust-agent/src/main.rs`) が **15 秒間隔** で emit
する。`STALE_WORKER_THRESHOLD_MS = 5 min` (`runner-constants.ts`) で 20 missed
beats まで許容。

::: warning Idempotency control RPC は endpoint ごとに retry safety が異なる。
`run-event` は run id + type + sequence を dedupe key として扱う。executor-host
isolate の 1h 短期 cache は best-effort で、host restart や cache expiry 後の
durable authority ではない。D1 `run_events` path では `event_key` unique
index、RunNotifier DO では storage-backed dedupe key が重複 emit
抑止の本体になる。`heartbeat` は timestamp update なので実質 idempotent。
`add-message` は任意の `idempotencyKey` を受け取り、同一 thread + 同一 key
を同じ replay として扱う。rust-agent の assistant message は run id + content
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

これは rust-agent / kernel 間の transport に寄せた意図的な設計で、public api.md
の error code table はこの層には適用しない。

## デプロイ

| worker                | wrangler 設定                             | container class                   |
| --------------------- | ----------------------------------------- | --------------------------------- |
| `takos-executor-host` | `apps/control/wrangler.executor.toml`     | `ExecutorContainerTier1/2/3`      |
| `takos-runtime-host`  | `apps/control/wrangler.runtime-host.toml` | `takos-runtime-service` container |

worker ごとの主な service binding は次のとおり。

- `takos-executor-host`: `TAKOS_CONTROL`
- `takos-runtime-host`: `TAKOS_WEB`

`takos-executor-host` と main `takos` worker は同じ `EXECUTOR_PROXY_SECRET`
を持つ。executor-host は LLM backend API key や DB/R2 binding を持たず、必要な
control RPC は `TAKOS_CONTROL` 経由で main worker に forward する。

## 関連ドキュメント

- [Runtime Service](/architecture/runtime-service) — `takos-runtime-host` 内で
  動く Deno HTTP server
- [Control plane](/architecture/control-plane) — kernel 側の DO / queue / cron
  全体図
- [Threads and Runs](/platform/threads-and-runs) — agent run lifecycle の user
  視点
