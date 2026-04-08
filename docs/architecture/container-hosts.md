# Container host RPC

`takos-runtime-host`, `takos-executor-host`, `takos-browser-host` は
Cloudflare Container DO sidecar を持つ専用 worker で、コンテナ内のプロセスと
control-plane の間を仲介する **Control RPC + Proxy** layer。

ソース: `packages/control/src/runtime/container-hosts/`

## 全体像

```
takos-runner / takos-web (kernel)
  │  ① POST /dispatch  (run start)
  ▼
takos-executor-host  (Container DO host)
  │  ② container.dispatchStart(payload)
  ▼
TakosAgentExecutorContainer  (CF Container DO with rust-agent inside)
  │  ③ POST /rpc/control/*  (RPC into kernel)
  ▼
takos-executor-host  (proxy / forward)
  │  ④ TAKOS_CONTROL.fetch  (service binding)
  ▼
takos-web /internal/executor-rpc/*
  │  ⑤ DB / queue / billing / memory-graph 等
  ▼
D1 / Vectorize / Queues / Run-notifier DO
```

`takos-browser-host` と `takos-runtime-host` も同じ pattern で、container 内の
Playwright / Deno に対する proxy として動く。

## Tier 構成 (executor)

`takos-executor-host` は 3 つの tier の Container DO class を export する:

| tier | class | sleepAfter | max instances | 用途 |
| --- | --- | --- | --- | --- |
| 1 | `ExecutorContainerTier1` | `10m` | ~20 | lite (常時 warm、軽量 agent) |
| 2 | `ExecutorContainerTier2` | `5m` | ~200 | basic (一般的な agent run) |
| 3 | `ExecutorContainerTier3` | `3m` | ~25 | custom (max memory 12GiB) |

dispatch payload に `tier?: 1 | 2 | 3` (default 1) を含めると、
`resolveContainerNamespace` (`executor-utils.ts`) が namespace を選択する。
fallback: 上位 tier の binding が無ければ tier 1 へ。

deprecated: `TakosAgentExecutorContainer` は legacy 単一 class で、新規 deploy
では使わない。

## 認証

`takos-web` worker の内部 call に使われる header は **2 つの別名** に分離
されている (Round 11 MEDIUM #11 fix)。混同しないこと:

1. **`X-Takos-Internal-Marker: "1"`** — edge auth middleware
   (`server/middleware/auth.ts` + `server/routes/sessions/auth.ts`) が読む
   sentinel。`takos-runtime-host` worker が `/forward/cli-proxy/*` /
   `/forward/heartbeat/*` を `env.TAKOS_WEB.fetch(...)` で kernel に渡す際に
   付ける。kernel 側では「このリクエストは service binding 経由で
   runtime-host 内から来た」と認識し、`X-Takos-Session-Id` / `X-Takos-Space-Id`
   header で container session を解決する。値 `"1"` は単なる in/out flag で
   secret ではない
2. **`X-Takos-Internal: <secret>`** — executor proxy API
   (`runtime/executor-proxy-api.ts`) の shared secret。`EXECUTOR_PROXY_SECRET`
   env var と constant-time 比較される。`takos-executor-host` worker が
   `TAKOS_CONTROL` service binding 経由で kernel の
   `/internal/executor-rpc/*` を呼ぶ際に付ける

両 header は **同じ worker (`takos-web`) に到達する別経路** の認証に使う。
legacy では両方が `X-Takos-Internal` という同じ名前だったため、sentinel
値 `"1"` を secret に取り違えた場合に auth bypass 攻撃が成立する余地が
あった。現在は (1) を rename することで攻撃面を分離してある。

container は自身の control RPC (runtime-service 内) では (2) の secret を
知らず、runtime-host を介した forward は (1) の marker を使う。container →
executor-host → kernel の dispatch path では executor-host の
`forwardToControlPlane` が (2) の secret を自前で付与する。

container 自身が control RPC を呼ぶ際の auth は **proxy token** (16 byte
hex) で、`dispatchStart` 時に `executor-proxy-config.ts buildAgentExecutorProxyConfig`
が生成し、container env vars (`AGENT_EXECUTOR_PROXY_TOKEN`) として渡される。
proxy token は DO storage の `proxyTokens` map に保存され、token →
`{runId, serviceId, capability: 'control'}` を解決する。

::: warning Token revocation
proxy token は run 完了時に **revoke されない**。`sleepAfter` window
(3-10 分) の間 valid のままで、container が cancel / leak された場合に
攻撃面が残る。Round 11 audit で MEDIUM finding として記録 (#6)、
`ProxyTokenManager.revoke()` を terminal status transition に呼び出す
fix が予定されている。
:::

## Control RPC endpoint matrix

`/rpc/control/*` は kernel 側の `/internal/executor-rpc/*` に 1:1 で
forward される (`executor-utils.ts CONTROL_RPC_PATH_MAP`)。production は
すべて `executor-proxy-api.ts createExecutorProxyRouter()` で受ける。

| `/rpc/control/...` | 用途 |
| --- | --- |
| `heartbeat` | run の lease 維持 (~15s 間隔) |
| `run-status` | run の現在 status を取得 |
| `run-record` | run record を更新 |
| `run-bootstrap` | run の初期 context (spaceId / threadId / sessionId) |
| `run-config` | agent type の system prompt + tools + max iterations |
| `run-fail` | run を failed としてマーク (lease 保持時のみ) |
| `run-reset` | run を queued に戻す (失敗 retry) |
| `run-context` | conversation に注入する追加 context |
| `no-llm-complete` | LLM を使わずに完了マーク |
| `current-session` | active session id 取得 |
| `is-cancelled` | cancel フラグ check |
| `conversation-history` | LLM input 用の message history |
| `skill-runtime-context` | 有効 skill の runtime context |
| `skill-catalog` | 利用可能 skill 一覧 |
| `skill-plan` | skill resolution plan |
| `memory-activation` | memory graph activation bundles |
| `memory-finalize` | memory claims / evidence の persist |
| `add-message` | conversation に message を追記 |
| `update-run-status` | run status を遷移 |
| `tool-catalog` | run の tool catalog |
| `tool-execute` | tool を kernel-side で実行 |
| `tool-cleanup` | tool 実行後のクリーンアップ |
| `run-event` | SSE / WS に event を emit |
| `billing-run-usage` | run 終了時の usage を recordUsage |
| `api-keys` | OpenAI / Anthropic / Google の API キー |

heartbeat は rust-agent (`apps/rust-agent/src/main.rs`) が **15 秒間隔** で
emit する。`STALE_WORKER_THRESHOLD_MS = 5 min` (`runner-constants.ts`) で
20 missed beats まで許容。

::: warning Idempotency
現状すべての endpoint は **non-idempotent** です。rust-agent からの retry で
重複 write を起こす可能性があります (`add-message`, `update-run-status`,
`run-event`, `heartbeat` が特に影響を受けやすい)。`run-event` は `sequence`
field を取るので dedupe 可能ですが、kernel side で active dedup していません。
retry safety が必要な caller は idempotency key 側 (run id + sequence 等) を
用いて自前で重複検出する必要があります。
:::

### Reserved bindings family

`takos-executor-host` には `/proxy/db/*`, `/proxy/offload/*`,
`/proxy/git-objects/*`, `/proxy/do/*`, `/proxy/vectorize/*`, `/proxy/ai/*`,
`/proxy/egress/*`, `/proxy/runtime/*`, `/proxy/browser/*`, `/proxy/queue/*`
の handler 群が実装されており、handler 自身は完全に動作する。ただし **現在
これらの endpoint に到達する dispatch path は存在しない**:

- 各 handler は `getRequiredProxyCapability()` (`executor-auth.ts`) で
  `bindings` capability を要求する
- しかし `createExecutorContainerClass.dispatchStart` (`executor-host.ts`)
  で発行される proxy token は `capability: 'control'` のみ
- したがって runtime 環境で `/proxy/{db,offload,...}/*` を呼ぶと必ず 401 で
  reject される

この設計は **reserved extension surface** として意図的に残してある。将来
「container が kernel の binding に直接アクセスできる実行モード」を追加
するときに、token 発行時に `capability: 'bindings'` を付与する dispatch
path を足せば即座に有効化できる構造になっている。削除する場合は kernel
全体の proxy infrastructure の大幅リファクタが必要になるため、現状維持
(dead-but-reserved) としている (Round 11 audit — Container Hosts
finding #2)。

実装 location: `packages/control/src/runtime/container-hosts/executor-host.ts`
の block comment (`// Reserved bindings family`) と
`packages/control/src/runtime/container-hosts/executor-proxy-handlers.ts`。

## エラー envelope

container host endpoint は **internal RPC** であり、public API common envelope
(`{ error: { code, message } }`) を **使わない**。flat `{ error: "string" }`
shape を返す (`shared/utils/http-response.ts errorJsonResponse`)。

これは意図的: rust-agent / kernel 間の internal protocol であり、public
api.md の error code table は適用されない。edge facing endpoint
(`server/routes/browser-sessions/routes.ts`) は common envelope を使うべき
だが、現状一部 flat shape のままになっている (Round 11 audit MEDIUM #4)。

## Browser host

`takos-browser-host` の `BrowserSessionContainer` は Playwright を内部で動かす:

| `/session/:id/...` | 用途 |
| --- | --- |
| `create` | session 作成 + Playwright bootstrap (URL / viewport) |
| `goto` | URL に遷移 |
| `action` | click / type / scroll |
| `extract` | HTML / text / screenshot 取得 |
| `pdf` | PDF レンダリング |
| `tab/new` / `tab/close` / `tab/switch` | tab 制御 |
| `html` / `screenshot` / `tabs` | state 取得 |

::: warning URL / viewport の validation
`createSession` は URL scheme を `http://` / `https://` のみ許可
(file:// / javascript: / data: は reject)、viewport は
`width 320-3840 × height 240-2160` に clamp する。
:::

::: tip Per-space concurrent session cap (Round 11 MEDIUM #12)
1 つの space が同時に持てる browser session 数は
**`MAX_BROWSER_SESSIONS_PER_SPACE = 5`**
(`packages/control/src/runtime/container-hosts/browser-session-host.ts`)
に固定されている。`createSession` は container を起動する前に per-space
counter Durable Object (`space-counter:<spaceId>` という名前の DO
instance) で slot を reserve し、超過なら
`Error('BROWSER_SESSION_CAP: Too many concurrent browser sessions ...')`
を throw する。

counter DO は `BrowserSessionContainer` と同じ class を再利用するが、
`startAndWaitForPorts` を呼ばないため **container は起動しない**。
storage のみの軽量 instance として動く。

edge route (`server/routes/browser-sessions/routes.ts` の
`POST /api/spaces/:spaceId/browser-sessions`) が host の 429 flat error
を受け取ると、public common envelope
`{ error: { code: 'RATE_LIMITED', message } }` に変換して 429 で返す。
container bootstrap が失敗した場合は slot を best-effort で release
するので、failed 作成による capacity leak は起きない。`destroySession`
でも slot は release される。
:::

## デプロイ

| worker | wrangler 設定 | container class |
| --- | --- | --- |
| `takos-executor-host` | `apps/control/wrangler.executor.toml` | `ExecutorContainerTier1/2/3` |
| `takos-browser-host` | `apps/control/wrangler.browser-host.toml` | `BrowserSessionContainer` |
| `takos-runtime-host` | `apps/control/wrangler.runtime-host.toml` | runtime container |

3 worker はすべて `TAKOS_CONTROL` service binding を持ち、kernel
(`takos-web` worker) の `/internal/executor-rpc/*` を呼べる必要がある。
`EXECUTOR_PROXY_SECRET` は両 worker の env var に同じ値を設定する。

## 関連ドキュメント

- [Runtime Service](/architecture/runtime-service) — `takos-runtime-host` 内で
  動く Deno HTTP server
- [Control plane](/architecture/control-plane) — kernel 側の DO / queue / cron
  全体図
- [Threads and Runs](/platform/threads-and-runs) — agent run lifecycle の
  user 視点
