# Control Plane

::: tip Internal implementation このページは control plane の internal
実装を説明する。public contract ではない。実装は変更される可能性がある。public
contract は [manifest spec](/reference/manifest-spec) と
[API reference](/reference/api) を参照。:::

Control plane は [Kernel](./kernel.md) の実装面。API, deploy pipeline, DB,
routing / workflow management を担う。deploy contract は primitive-first で、
worker / service / route / publication / resource を個別 record として扱う。
Group は primitive を任意に束ねる state scope であり、runtime backend や
resource provider ではない。worker / service / attached container は `services`
/ `deployments`、resource は `resources`、publication は `publications`
として個別に存在する。`publish` は information sharing catalog であり、resource
creation や backend selection、generic plugin resolver ではない。SQL /
object-store / queue などの resource API / runtime binding は publish と分ける。

## 役割

- browser / CLI からの `/api/*` request
- auth / OAuth / billing / setup
- primitive deploy / reconcile と group 機能
- publication catalog 管理と explicit consume の env injection
- resource / binding 管理
- routing management

## 実行コンポーネント

```text
browser / CLI
  → takos (main worker)
     → takos-dispatch (tenant routing)
     → takos-worker (background jobs)
     → takos-runtime-host (worker bundle / runtime-service host)
```

### `takos`

main worker。`{ADMIN_DOMAIN}` で serve。

- chat SPA + `/api/*`
- auth / OAuth / session / JWKS (`/auth/*`)
- `/settings`
- setup
- billing
- route registration と control-plane cron
- publication catalog 管理と explicit consume の env injection（deploy 時）

### `takos-dispatch`

tenant routing を受け持つ dispatch worker。tenant/custom host を group
に振り分ける。

- `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}` → group の worker（auto
  hostname）
- `{custom-slug}.{TENANT_BASE_DOMAIN}` → group の worker（custom slug）
- custom domain → group の worker

### `takos-worker`

background worker。

- deployment queue
- workflow queue
- index queue
- egress proxy
- background cron / recovery

### `takos-runtime-host`

`runtime-host` は 2 つの文脈で使われる。

- backend-specific runtime で Worker `worker-bundle` を扱う deployment adapter
  名
- `takos-runtime-service` container を host / forward する Cloudflare worker

どちらの文脈でも、group の image-backed container workload を直接 materialize
する役割ではない。

image-backed `services` / `containers` は OCI deployment adapter / orchestrator
側で materialize される。worker-attached container workload は current runtime
では worker-side binding で resolved endpoint に接続される。

### CLI proxy loopback bypass

operator の workstation にある Takos CLI から runtime-service の CLI-proxy
endpoint (`/cli-proxy/*`) に到達するまでの traffic flow:

```text
CLI on operator workstation
  │  ① HTTPS POST → kernel API
  │     Authorization: Bearer <PAT>
  ▼
takos (main worker)
  │  ② PAT 認証 + session lookup
  │  ③ env.RUNTIME_HOST.fetch(...)  (service binding)
  ▼
takos-runtime-host worker
  │  ④ /forward/cli-proxy/* を
  │     container loopback 経由で呼び出す
  ▼
takos-runtime-service (container, 127.0.0.1)
  │  ⑤ `/cli-proxy/*` で X-Forwarded-For が loopback であることを確認
  │  ⑥ allowlist path (`/api/repos/:id/(import|export|status|log|commit)`)
  │     のみ forward を許可
  │  ⑦ session proxy token で runtime-host に戻す
  ▼
takos-runtime-host worker
  │  ⑧ proxy token を検証して kernel API に中継
  ▼
takos (main worker)
  │  ⑨ `/api/repos/:id/*`
  ▼
実 git/repo 処理
```

- ① → ②: kernel 側で PAT を検証 (`tak_pat_*` prefix + DB lookup) したうえで
  session を引く
- ②: container mode では (3) のように service binding 経由で runtime-host を
  呼ぶ。これは worker bundle / runtime-service host 経路であり、container
  workload の materialization そのものではない。通常の direct HTTP mode では
  kernel から runtime-service の `/cli-proxy/*` を直接呼ぶ (loopback bypass は
  使わない)
- ③ → ④: `RUNTIME_HOST` service binding は Cloudflare worker binding なので、
  kernel → runtime-host は net hop を経由しない
- ④: `runtime-host` は container 内の deno process に loopback で到達する (CF
  Container DO は `127.0.0.1` を立てる)
- ⑤ → ⑥: `X-Forwarded-For` / `X-Real-IP` が `127.0.0.1` / `::1` /
  `::ffff:127.0.0.1` の場合に service-token JWT 不要の bypass 条件を満たす。
  bypass 時も `X-Takos-Session-Id` は required で、session vs `X-Takos-Space-Id`
  の照合で space 分離が保たれる
- ⑦ → ⑨: runtime-service は repo 操作を直接実行せず、session の proxy token で
  runtime-host の `/forward/cli-proxy/*` に戻す。runtime-host が token
  を検証し、kernel の `/api/repos/:id/*` に中継する
- `X-Forwarded-For` の spoof 防止は **ingress 側の責務**: CF Container は
  外部から渡された header を丸ごと渡すので、kernel / runtime-host で header を
  strip する必要がある。bypass 経路全体の詳細は
  [runtime-service § CLI-proxy loopback bypass](/architecture/runtime-service#cli-proxy-loopback-bypass)
  を参照

## Dispatch Namespace

tenant worker は Cloudflare backend では dispatch namespace
を使って論理分離される。これは operator / backend 側の deployment detail
であり、public CLI の `takos deploy` / `takos install` には `--namespace` option
は露出していない。

## API surface

### Kernel API

kernel 自身が提供する API。

- auth / session / PAT / OAuth
- space management (members, settings)
- group management (install, deploy, rollback, uninstall)
- resource management
- publication catalog 管理と explicit consume の env injection（deploy 時）
- billing / metering
- notifications

### Group-provided API

group が自身の routes で提供する API。kernel の責務ではない。

例:

- MCP tools (third-party group)
- Document editing (takos-docs)
- Spreadsheet operations (takos-excel)

## 永続化の構成

### Kernel schema

kernel が所有する DB schema。Agent, Git, Storage, Store は kernel
の機能であり、kernel DB で管理する。

| schema group | responsibility                                |
| ------------ | --------------------------------------------- |
| Spaces       | space, membership, profile                    |
| Auth         | session, PAT, service token                   |
| Billing      | billing account, plan, usage                  |
| Repos        | repository, commit, branch, blob, PR          |
| Agents       | thread, message, run, skill, memory, artifact |
| Storage      | file metadata, storage files                  |
| Store        | registry, inventory, catalog                  |
| Services     | service, binding, common env                  |
| OAuth        | client, consent, token                        |
| Platform     | resource, session, notification               |
| Workflows    | run, job, step, artifact                      |
| Workers      | group, deployment, publication, custom domain |

## Deploy pipeline

kernel 外の primitive に適用される。docs, excel, slide, user-defined workloads
は同じ primitive model で扱う。kernel の機能（agent, git, storage, store）は
kernel に統合済みであり、deploy pipeline の対象外。

```text
1. Parse manifest (.takos/app.yml)
2. Resolve publication catalog / consume bindings
3. Generate desired declaration
4. Diff against current state
5. Apply（topological order, depends に従う）
6. Inject env（local env + consumed publication outputs）
7. Update routing（hostname → compute endpoint）
```

### Deploy atomicity

deploy は以下の単位で failure boundary を持つ:

1. migration 失敗 → deploy 全体が fail。worker は起動しない
2. worker deploy 失敗 → routing は更新されない。前の deployment が serve 続行
3. routing update 失敗 → retry する。worker は deploy 済みだが到達不能（一時的）

Service / Attached container の `healthCheck` は deploy target orchestrator
に渡す入力であり、kernel が deploy 後に定期監視するものではない。group apply
の結果に失敗が含まれる場合は `group.unhealthy` event を emit する。Worker は
manifest で health check を宣言しないが、kernel が deploy 時に `GET /` で
readiness を確認する（詳細は [Worker readiness](#worker-readiness)）。

### Publication lifecycle

publication は primitive が共有する information catalog entry で、deploy
pipeline と連動する:

- deploy 時: manifest の `publish` を deploy DB に登録
- consumer reconcile 時: `consume` を宣言した compute にだけ env として解決
- manifest-managed entry の削除時: deploy DB から除去 → 次回 deploy 時に env
  から消える
- group unhealthy 時: publication は残るが、利用側は graceful degradation で対処

publication に TTL はない。manifest-managed entry が存在する限り publication
も存在する。必須 field は entry の種類によって異なる。

- route publication: `name` + `publisher` + `type` + `path`
- Takos capability grant: `name` + `publisher: takos` + `type` + `spec`

route publication の URL は assigned hostname と manifest の `path` から
生成され、path template は template URL のまま扱う。`type` は custom string
で、core は type の意味を解釈しない。Takos capability grant の `publisher` は
`takos`、`type` は Takos publisher type だけを受け付け、`spec` は type ごとの
required / optional field を持つ。kernel features (Agent / Chat, Git, Storage,
Store, Auth) は kernel API として直接提供されるため、route publication
の対象外。

## Routing layer

routing は hostname → deployment/endpoint の解決を担う独立した層。hostname
により control plane と group runtime に振り分ける。

- `{ADMIN_DOMAIN}` (admin host) → `control-web` (kernel API / auth / settings)
- auto hostname / custom slug / custom domain → `control-dispatch` → group の
  worker

### データモデル

```
RoutingRecord
  hostname: string           → group の hostname (例: my-storage.app.example.com)
  target: RoutingTarget      → ルーティング先
  version: number            → 楽観的排他制御
  updatedAt: number
  tombstoneUntil?: number    → 削除猶予
```

RoutingTarget は 2 種類:

```
Type 1: "deployments"（worker workload）
  deployments:
    - routeRef: string       → dispatch namespace 内の worker 参照
    - weight: number         → traffic 配分（canary: 1-99%）
    - deploymentId: string
    - status: active | canary | rollback

Type 2: "http-endpoint-set"（service / container workload）
  endpoints:
    - name: string
    - routes: [{path, methods}]
    - target: {kind: service-ref | http-url, ref/baseUrl}
    - timeoutMs?: number
```

### Hostname の種類

| 種類          | 形式                                             | 管理                              |
| ------------- | ------------------------------------------------ | --------------------------------- |
| Auto hostname | `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}` | deploy 時に自動生成               |
| Custom slug   | `{custom-slug}.{TENANT_BASE_DOMAIN}`             | ユーザーが設定（globally unique） |
| Custom domain | `any.domain.com`                                 | ユーザーが追加、DNS 検証 + SSL    |
| Admin host    | `{ADMIN_DOMAIN}`                                 | 固定ロジック                      |

auto hostname / custom slug / custom domain の 3 つはすべて同じ
RoutingTarget（同じ group worker）を指す。

admin host (`{ADMIN_DOMAIN}`) は RoutingRecord を使わず、ingress/edge の固定
ルールで `control-web` に routing される。group は RoutingRecord の hostname を
`control-dispatch` が解決して routing される。

### Deploy 時の routing 更新

group deploy 時に kernel は:

1. manifest の routes から desired endpoint set を compile する
2. group の hostname に対して RoutingRecord を upsert する
3. canary deploy の場合は weight を設定する（active + canary の 2 target）

### Canary deploy

```
hostname → deployments:
  - routeRef: current-worker, weight: 90, status: active
  - routeRef: new-worker, weight: 10, status: canary
```

dispatch は weight に基づいてランダムに振り分ける。canary の切り替えは `promote`
/ `rollback` の明示操作で行う。

### Canary 状態遷移

```
           deploy
idle ──────────→ active (100%) + canary (weight%)
                    │
            promote │
                    ↓
           active (100%, new worker)
                    │
          rollback  │
                    ↓
           active (100%, previous worker) + rollback target archived
```

- `promote`: canary の weight を 100 に、previous active を archived に
- `rollback`: canary を archived に、previous active の weight を 100 に戻す
- canary deploy 中に新たな deploy は blocked

### Health monitoring

kernel は deploy 後に group の Service / Attached container
を定期的に監視しない。manifest の `healthCheck` field は **Service / Attached
container の deploy 入力** としてのみ使われる。

- `path`: `GET /health`（default）or manifest で指定
- `interval` / `timeout` / `unhealthyThreshold`: deployment target orchestrator
  に渡す設定

Worker は request-driven のため manifest で health check を宣言しない。

### Worker readiness

Worker は healthCheck を持たないが、deploy 時に kernel が readiness を確認する:

1. Worker を deploy
2. kernel が readiness path を Worker に送信（default: `GET /`）
3. HTTP 200 を受け取れば ready
4. 201 / 204 / 3xx / 4xx / 5xx / timeout (10s) は deploy fail

readiness path は manifest で指定可能（default: `GET /`）。root path が HTTP 200
を返せない Worker（例: MCP-only endpoint）は `compute.<name>.readiness`
フィールドで override する。

routing 用の hostname / route がまだ割り当てられていない Worker は readiness
probe を skip する。

routing 切り替えはこの readiness 確認の後に行う。

canary deploy は routing weight を付けて開始するだけで、health 変化に応じた 自動
rollback はこの contract には含めない。rollback が必要な場合は canary abort /
rollback API で明示的に戻す。

### Multi-tier cache

routing 解決は 3 層キャッシュで高速化する。

```
L1: isolate-local Map (TTL 10s, max 2048 entries)
 ↓ miss
L2: KV namespace (TTL 90s)
 ↓ miss
L3: Durable Object (strong consistency, hostname でシャード)
```

write は DO → KV → L1 の順で伝播する。読み取りは L1 → KV → DO の順で fallback
する。

L1 は TTL ベースで更新される（最大 10 秒の staleness を許容）。deploy 直後は L1
が古い target を返す可能性がある。critical な routing 変更（rollback 等）では L1
TTL を待つか、dispatch の再起動で L1 を flush する。

L1 は LRU eviction で管理する。max entries を超えた場合は最も古い entry
を破棄する。大規模環境（多数の hostname）では L1 hit rate が下がるが、L2 (KV) が
fallback するため latency は許容範囲内。

### Group routes

manifest の `routes` field は group routes として compile される。

```yaml
routes:
  - target: main
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000
```

1 つの group hostname に対して複数の route を設定可能。dispatch は path + method
で最長一致を選択する。同じ path で method が重なる route は duplicate として
invalid。route publication は `publisher + path` で route
を参照するため、manifest 全体で同じ `publisher + path`
が複数件に一致してはいけない。

### Dispatch の routing 境界

dispatch は group レベルだけでなく、group 内の worker レベルまで routing する。

1. hostname から group を特定
2. group の RoutingRecord を取得
3. RoutingTarget の種類で分岐:
   - "deployments": weight-based で deployment を選択 → routeRef で worker
     に到達
   - "http-endpoint-set": path + method で endpoint を選択 → service-ref or
     http-url に到達

group 内に複数 worker がある場合、dispatch が path で適切な worker を選ぶ。
group の worker は自分宛の request だけを受け取る。

## Bootstrap 順序

space の初回起動時の順序:

1. kernel が起動する（auth, routing が ready）
2. docs, excel, slide は default app distribution の初期セットとして preinstall
   対象にできる。operator はこの app set を差し替えられる。default set
   に含まれても primitive や group は特権化されない。
3. deploy 時に kernel が各 primitive の `publish` / `compute.<name>.consume`
   を解決し、consumer が要求した env だけを inject する（全 group 自動注入は
   しない）
4. deploy された workload が起動し、`/auth/` で認証を検証できる状態になる

group は kernel が ready になるまで起動を待つ。kernel の readiness は
`/.well-known/jwks.json` の応答で判定する。

group が他 group の publication を参照する場合、その group がまだ deploy
されていないと 対応する env 変数が存在しない。group はこれを graceful
に扱う必要がある （エラーではなく、機能が利用不可の状態として表示する）。

default app distribution に含まれる groups 間の publication 依存は保証しない。
初回 deploy / 利用開始直後は 他 group の publication env がまだ inject
されていない場合がある。各 group は graceful degradation で対処する（env
が未設定でも起動する）。

## Group deletion

group 削除時に kernel は以下を順に実行する:

1. routing を削除（RoutingRecord を tombstone）
2. publications を削除（deploy DB から除去）
3. `group.deleted` event を発行
4. worker を停止
5. consumed publication outputs を解除
6. group record を削除

## Request flow

### kernel API

```text
client
  → {ADMIN_DOMAIN}/api/* or /auth/* or /settings
  → control-web
  → auth middleware
  → route family (management API, auth, settings)
```

### group hostname → group runtime

```text
client
  → {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}/* (auto hostname)
  → takos-dispatch
  → hostname で group を特定（auto / custom slug / custom domain いずれも同じ）
  → group の worker → group logic
```

## Queue と stream

queue と DO ベースの notifier を併用する。

- queue: deployment, workflow, index, **runs** (`RUN_QUEUE` / `takos-runs`)
- DO stream: notification notifier, run notifier
- DO infra: session, routing, rate limiter, git push lock
- container DO: runtime host, executor host

各 queue には DLQ (`*-dlq`) が `apps/control/wrangler.worker.toml` の
`[[queues.consumers]]` の `dead_letter_queue` field で設定されている。配送に
`max_retries` 回 (queue ごとに 2-3) 失敗した message は自動的に DLQ へ rotate
される。kernel 側で DLQ message を replay する仕組みは 現状無く、operator
が手動で `wrangler queues consumer dlq move` する想定。

| queue                                    | max_retries | DLQ                         |
| ---------------------------------------- | ----------- | --------------------------- |
| `RUN_QUEUE` (`takos-runs`)               | 3           | `takos-runs-dlq`            |
| `INDEX_QUEUE` (`takos-index-jobs`)       | 2           | `takos-index-jobs-dlq`      |
| `WORKFLOW_QUEUE` (`takos-workflow-jobs`) | 3           | `takos-workflow-jobs-dlq`   |
| `DEPLOY_QUEUE` (`takos-deployment-jobs`) | 3           | `takos-deployment-jobs-dlq` |

### Cron schedules

control-plane web worker (`apps/control/wrangler.toml [triggers]`) は 2 系統の
cron を運用する。Cloudflare の cron-storm window を避けるため offset を
使用している:

| schedule (wrangler)  | dev / HTTP form | family       | family jobs                                                                                   |
| -------------------- | --------------- | ------------ | --------------------------------------------------------------------------------------------- |
| `3,18,33,48 * * * *` | `*/15 * * * *`  | quarter hour | custom domain reverify, stuck-domain reconcile, default app preinstall                        |
| `5 * * * *`          | `0 * * * *`     | hourly       | dead session cleanup, snapshot GC, R2 orphaned object GC, workflow artifact GC, AP retry tick |

control-plane web worker の `scheduled()` handler は `isQuarterHourCron(cron)` /
`isHourlyCron(cron)` で family を判定し、両方の cron 表記を同じ job に dispatch
する。family job の後、全 cron で common env scheduled maintenance、app schedule
dispatch、workflow schedule dispatch を実行する。

control-plane runtime worker (`apps/control/wrangler.worker.toml`) は
`1-59/2 * * * *` (奇数分ごと) で `runtime/runner/index.ts` の stale-run recovery
を実行する。recovery は cron 文字列で branch せず、毎回 unconditional に走る。

dev 環境では `POST /internal/scheduled?cron={form}` を loopback / cluster
hostname から叩くと同じ family 判定で HTTP 互換の maintenance job を実行できる
(`/internal/scheduled` endpoint)。`cron=* * * * *` は quarter hour / hourly の両
family をまとめて実行する。workflow artifact GC は Cloudflare `scheduled()`
handler の hourly job として実行する。

## DB migration

SQL schema 変更は resource / backend 側の migration として管理する。

### Migration の実行

backend 実装によっては SQL resource に対して migration を実行できる。public
publish contract は schema 変更の実行手順を記述しない。resource API / runtime
binding と migration は backend 側で管理する。

### Rollback と migration

group snapshot には migration 状態が含まれる。rollback 時、kernel は
forward-only migration のみサポートする。schema
を巻き戻す必要がある場合は、新しい migration として書く。

migration が失敗した場合、deploy 全体が fail する。group の worker
は起動しない。

### Atomicity

group を指定した deploy の atomicity は group inventory 単位。

- migration + worker deploy + routing update が 1 つの group-scoped deploy
  として atomic
- migration 成功 → worker deploy 失敗 の場合、migration は rollback
  されない（forward-only）
- 代わりに deploy 全体が fail 状態になり、前の group snapshot が serve
  され続ける
- 別の group の deploy には影響しない（group 間の deploy は独立）
