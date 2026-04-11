# Control Plane

::: tip Internal implementation このページは control plane の internal
実装を説明する。 public contract ではない。実装は変更される可能性がある。 public
contract は [manifest spec](/reference/manifest-spec) と
[API reference](/reference/api) を参照。

特に `storage bindings` や旧 publication env fanout に関する記述は internal
history を含む。現行の app deploy contract は `publish + consume` が正本。 :::

Control plane は [Kernel](./kernel.md) の実装面。API, deploy pipeline, DB,
routing management を担う。

## 役割

- browser / CLI からの `/api/*` request
- auth / OAuth / billing / setup
- group deploy / reconcile / rollback
- publication env injection
- resource / binding 管理
- routing management

## 実行コンポーネント

```text
browser / CLI
  → takos (main worker)
     → takos-dispatch (tenant routing)
     → takos-worker (background jobs)
     → takos-runtime-host (container hosting)
```

### `takos`

main worker。`{KERNEL_DOMAIN}` で serve。

- chat SPA + `/api/*`
- auth / OAuth / session / JWKS (`/auth/*`)
- `/settings`
- setup
- billing
- route registration と control-plane cron
- publication env injection（deploy 時に全 group の publish を解決し env に
  inject）

### `takos-dispatch`

tenant routing を受け持つ dispatch worker。 hostname で kernel or group
に振り分ける。

- `{KERNEL_DOMAIN}` → kernel（`/api/*`, `/auth/*`, `/settings`）
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

generic container host。group が container workload を持つ場合、 runtime-host が
container のライフサイクルを管理する。

worker-attached container workload は current runtime では namespace binding
経由で worker から参照される。Cloudflare backend でも image-backed `services` /
`containers` 自体は OCI deployment adapter で解決される。

### CLI proxy loopback bypass

operator の workstation にある Takos CLI から runtime-service の CLI-proxy
endpoint (`/cli-proxy/*`) に到達するまでの traffic flow:

```text
CLI on operator workstation
  │  ① HTTPS POST /api/cli-proxy/...
  │     Authorization: Bearer <PAT>
  ▼
takos (main worker)
  │  ② PAT 認証 + session lookup
  │  ③ env.RUNTIME_HOST.fetch(...)  (service binding)
  ▼
takos-runtime-host worker
  │  ④ proxy token 検証 → /forward/cli-proxy/* を
  │     container loopback 経由で呼び出す
  ▼
takos-runtime-service (container, 127.0.0.1)
  │  ⑤ X-Forwarded-For が loopback であることを確認
  │  ⑥ allowlist path (`/api/repos/:id/(import|export|status|log|commit)`)
  │     のみ forward を許可
  ▼
実 git/repo 処理
```

- ① → ②: kernel 側の `/api/cli-proxy/*` route が PAT を検証 (`tak_pat_*`
  prefix + DB lookup)
- ②: container mode では (3) のように service binding 経由で runtime-host を
  呼ぶ。通常の direct HTTP mode ではここで kernel が直接 runtime-service を 叩く
  (loopback bypass は使わない)
- ③ → ④: `RUNTIME_HOST` service binding は Cloudflare worker binding なので、
  kernel → runtime-host は net hop を経由しない
- ④: `runtime-host` は container 内の deno process に loopback で到達する (CF
  Container DO は `127.0.0.1` を立てる)
- ⑤ → ⑥: `X-Forwarded-For` / `X-Real-IP` が `127.0.0.1` / `::1` /
  `::ffff:127.0.0.1` の場合に service-token JWT 不要の bypass 条件を満たす。
  bypass 時も `X-Takos-Session-Id` は required で、session vs `X-Takos-Space-Id`
  の照合で workspace 分離が保たれる
- `X-Forwarded-For` の spoof 防止は **ingress 側の責務**: CF Container は
  外部から渡された header を丸ごと渡すので、kernel / runtime-host で header を
  strip する必要がある。bypass 経路全体の詳細は
  [runtime-service § CLI-proxy loopback bypass](/architecture/runtime-service#cli-proxy-loopback-bypass)
  を参照

## Dispatch Namespace

tenant worker は Cloudflare backend では dispatch namespace
を使って論理分離される。 これは operator / backend 側の deployment detail
であり、current public CLI の `takos deploy` / `takos install` には
`--namespace` option は露出していない。

## API surface

### Kernel API

kernel 自身が提供する API。

- auth / session / PAT / OAuth
- space management (members, settings)
- group management (install, deploy, rollback, uninstall)
- resource management
- publication env injection（deploy 時）
- billing / metering
- notifications

### Group-provided API

group が自身の routes で提供する API。kernel の責務ではない。

例:

- MCP tools (takos-computer)
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

外部 group（computer, docs, excel, slide, user apps）の deploy に適用される。
kernel の機能（agent, git, storage, store）は kernel に統合済みであり、deploy
pipeline の対象外。

```text
1. Parse manifest (.takos/app.yml)
2. Resolve publish → env injection 準備
3. Generate desired state
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

routing は Service の health check 成功後に更新する。 Service が unhealthy なら
routing は切り替わらない。 Worker は manifest で health check を宣言しないが、
kernel が deploy 時に `GET /` で readiness を確認する（詳細は
[Worker readiness](#worker-readiness)）。

### Publication lifecycle

publication は group の deploy と連動する:

- group deploy 時: manifest の `publish` を deploy DB に登録
- consumer reconcile 時: `consume` を宣言した compute にだけ env として解決
- group 削除時: deploy DB から除去 → 次回 deploy 時に env から消える
- group unhealthy 時: publication は残るが、利用側は graceful degradation で対処

publication に TTL はない。group が存在する限り publication も存在する。
publication の必須 field は `type` と `path` の 2 つ。すべての publication が
URL を持つ。 kernel features (Agent / Chat, Git, Storage, Store, Auth) は kernel
API として直接提供されるため、publication の対象外。

## Routing layer

routing は hostname → deployment/endpoint の解決を担う独立した層。 hostname
により kernel or group に振り分ける。

- `{KERNEL_DOMAIN}` → kernel
- auto hostname / custom slug / custom domain → group の worker

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
| Kernel        | `{KERNEL_DOMAIN}`                                | 固定ロジック                      |

auto hostname / custom slug / custom domain の 3 つはすべて同じ
RoutingTarget（同じ group worker）を指す。

kernel は RoutingRecord ではなく dispatch の固定ロジックで routing される。
group は RoutingRecord の hostname で routing される。

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

dispatch は weight に基づいてランダムに振り分ける。 canary を promote すると
weight が 100:0 に切り替わる。

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
           active (100%, old worker) + rollback target archived
```

- `promote`: canary の weight を 100 に、old active を archived に
- `rollback`: canary を archived に、old active の weight を 100 に戻す
- canary deploy 中に新たな deploy は blocked

### Health monitoring

kernel は deploy 後も group の Service / Attached container の health を
定期的にチェックする。manifest の `healthCheck` field を使用するのは **Service /
Attached container のみ**。

- health check path: `GET /health`（default）or manifest で指定
- check 間隔: 30 秒
- unhealthy 判定: 3 回連続失敗

Worker は request-driven のため manifest で health check を宣言しない。

### Worker readiness

Worker は healthCheck を持たないが、deploy 時に kernel が readiness を確認する:

1. Worker を deploy
2. kernel が readiness path を Worker に送信（default: `GET /`）
3. 200/2xx/3xx を受け取れば ready
4. 5xx または timeout (10s) なら deploy fail

readiness path は manifest で指定可能（default: `GET /`）。root path が 200
を返せない Worker（例: MCP-only endpoint）は `compute.<name>.readiness`
フィールドで override する。

routing 切り替えはこの readiness 確認の後に行う。

canary deploy 中は canary target の health を優先的にチェックする。 unhealthy
になった canary は自動的に rollback される。

promote 後に active target が unhealthy になった場合、 kernel は
`group.unhealthy` event を発行するが自動 rollback はしない。

### Multi-tier cache

routing 解決は 3 層キャッシュで高速化する。

```
L1: isolate-local Map (TTL 10s, max 2048 entries)
 ↓ miss
L2: KV namespace (TTL 90s)
 ↓ miss
L3: Durable Object (strong consistency, hostname でシャード)
```

write は DO → KV → L1 の順で伝播する。 読み取りは L1 → KV → DO の順で fallback
する。

L1 は TTL ベースで更新される（最大 10 秒の staleness を許容）。 deploy 直後は L1
が古い target を返す可能性がある。 critical な routing 変更（rollback 等）では
L1 TTL を待つか、 dispatch の再起動で L1 を flush する。

L1 は LRU eviction で管理する。max entries を超えた場合は最も古い entry
を破棄する。 大規模環境（多数の hostname）では L1 hit rate が下がるが、L2 (KV)
が fallback するため latency は許容範囲内。

### Group routes

manifest の `routes` field は group routes として compile される。

```yaml
routes:
  - target: main
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000
```

1 つの group hostname に対して複数の route を設定可能。 dispatch は path +
method で最長一致を選択する。

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
2. kernel が space template を読み、default groups (computer, docs, excel,
   slide) を deploy する
3. deploy 時に kernel が space 内のすべての publication を解決し、すべての group
   の env に inject する（scoping や dependency declaration なし）
4. 各 group が起動し、`/auth/` で認証を検証できる状態になる

group は kernel が ready になるまで起動を待つ。 kernel の readiness は
`/auth/.well-known/jwks.json` の応答で判定する。

group が他 group の publication を参照する場合、その group がまだ deploy
されていないと 対応する env 変数が存在しない。group はこれを graceful
に扱う必要がある （エラーではなく、機能が利用不可の状態として表示する）。

default groups 間の publication 依存は保証しない。 bootstrap 直後は他 group の
publication env がまだ inject されていない場合がある。 各 group は graceful
degradation で対処する（env が未設定でも起動する）。

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
  → {KERNEL_DOMAIN}/api/* or /auth/* or /settings
  → takos-dispatch
  → hostname = {KERNEL_DOMAIN} → kernel を特定
  → takos (main worker)
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
- container DO: runtime host, executor host, browser host

各 queue には DLQ (`*-dlq`) が `apps/control/wrangler.worker.toml` の
`[[queues.consumers]]` の `dead_letter_queue` field で設定されている。 配送に
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

| schedule (wrangler)  | dev / HTTP form | family       | jobs                                                                             |
| -------------------- | --------------- | ------------ | -------------------------------------------------------------------------------- |
| `3,18,33,48 * * * *` | `*/15 * * * *`  | quarter hour | custom domain reverify, stuck-domain reconcile, common-env reconcile batch       |
| `5 * * * *`          | `0 * * * *`     | hourly       | dead session cleanup, snapshot GC, R2 orphaned object GC, common-env drift sweep |

`packages/control/src/web.ts` の `scheduled()` handler は
`isQuarterHourCron(cron)` / `isHourlyCron(cron)` で family を判定し、 両方の
cron 表記を同じ job に dispatch する。

control-plane runtime worker (`apps/control/wrangler.worker.toml`) は
`1-59/2 * * * *` (奇数分ごと) で `runtime/runner/index.ts` の stale-run recovery
を実行する。recovery は cron 文字列で branch せず、毎回 unconditional に走る。

dev 環境では `POST /internal/scheduled?cron={form}` を loopback / cluster
hostname から叩くと同じ maintenance job を実行できる (`web.ts:230` の
`/internal/scheduled` endpoint)。

## DB migration

group の sql schema 変更は group 自身が管理する。

### Migration の実行

provider 実装によっては SQL resource に対して migration を実行できるが、現行の
public manifest contract に `storage.db.migrations` のような field はない。

### Rollback と migration

deployment snapshot には migration 状態が含まれる。 rollback 時、kernel は
forward-only migration のみサポートする。 schema
を巻き戻す必要がある場合は、新しい migration として書く。

migration が失敗した場合、deploy 全体が fail する。 group の worker
は起動しない。

### Atomicity

deploy の atomicity は group 単位。

- migration + worker deploy + routing update が 1 つの group deploy として
  atomic
- migration 成功 → worker deploy 失敗 の場合、migration は rollback
  されない（forward-only）
- 代わりに deploy 全体が fail 状態になり、前の deployment snapshot が serve
  され続ける
- 別の group の deploy には影響しない（group 間の deploy は独立）
