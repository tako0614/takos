# Control Plane

::: tip Internal implementation このページは control plane の internal
実装を説明する。public contract ではない。実装は変更される可能性がある。public
contract は [manifest spec](/reference/manifest-spec) と
[API reference](/reference/api) を参照。 :::

::: info control plane は 2 層 Installable App Model における control plane は
**2 層** に分かれます。

- **Account plane** = [Takosumi Accounts](./takosumi-accounts.md) (forward
  3-level dotted service identifier `takosumi.account.auth@v1` /
  `takosumi.account.billing@v1` で参照される service set、 endpoint URL は
  anchor 経由で operator-injected 値として resolve) — identity / billing /
  AppInstallation 台帳。 OAuth / OIDC issuer / upstream IdP / Stripe / consent
  screen を所有する。
- **Kernel control** = takosumi kernel の control 面 (本ページ) — manifest apply
  / provider DAG / resource resolution / routing layer / Deployment lifecycle
  を所有する。

本ページは **kernel control** 側の実装を扱います。account plane の正本は
[Takosumi Accounts](./takosumi-accounts.md)、AppInstallation 台帳の正本は
[AppInstallation 台帳](./app-installation.md) を参照してください。 :::

Control plane は [Kernel](./kernel.md) の実装面。API, deploy pipeline, DB,
routing / resource reconciliation を担う。deploy contract は Shape resource
first で、`resources[]`、route projection、service imports を Deployment 単位で
扱う。

## 2 層の責務分離

| 層                 | service                                                                        | 持つもの                                                                                                                                                     | 持たないもの                                                                     |
| ------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **Account plane**  | Takosumi Accounts (`takosumi.account.auth@v1` / `takosumi.account.billing@v1`) | account / login / passkey / upstream IdP broker / OAuth / OIDC issuer / Stripe / billing / AppInstallation / serviceImports metadata / AppBinding / AppGrant | manifest apply / provider DAG / Deployment lifecycle / routing materialization   |
| **Kernel control** | takosumi kernel control 面 (本ページ)                                          | manifest apply / provider DAG / outputs resolver / Deployment lifecycle / GroupHead / route projection / resource broker / event bus                         | account / login / billing / OAuth issuer / consent screen / AppInstallation 台帳 |

kernel control は AppInstallation 台帳の record そのものを持たず、Takosumi
Accounts から渡される **compiled manifest** (placeholder ゼロ) と
`installation.id` だけを受け取って apply します。逆に Takosumi Accounts は
manifest を解釈せず、AppInstallation の identity / source pin / service import
approval metadata / billing / grant を ledger として持ちます。

kernel features の正本記述は [Kernel](./kernel.md) を参照。Auth / Billing は
kernel features に **含まれません**。 これらは
[Takosumi Accounts](./takosumi-accounts.md) (account plane、
`takosumi.account.auth@v1` / `takosumi.account.billing@v1`) に集約されます。

current kernel-bound manifest は top-level `publications[]` / `bindings[]` を
持ちません。app catalog / MCP / file handler などの app-facing metadata は Takos
app / installer layer で扱い、kernel control は compiled Shape manifest を apply
します。

PaaS Core 視点では、control plane は compiled Shape manifest を Deployment
として record し、`applied` 遷移と GroupHead 進行で route projection を
materialize する process role の集合。Group は primitive を任意に束ねる state
scope であり、runtime backend や resource provider ではない。current manifest
では workload / database / domain などを `resources[]` の `shape` / `name` /
`provider` / `spec` で固定し、resource 間配線は `${ref:...}` /
`${secret-ref:...}`、cross-instance service は `imports[]` /
`serviceResolvers[]` で表現する。

## 役割

kernel control が担う役割は次のとおり。account / OAuth issuer / billing は
account plane (Takosumi Accounts) の責務であり、本ページの対象外です。

- trusted caller (takosumi-git / operator / Takos app gateway) から渡される
  compiled manifest の Deployment lifecycle
- primitive deploy / reconcile と GroupHead 進行
- service import descriptor pinning と resource output / secret-ref materialize
- resource provider / route projection 管理
- AppInstallation の `installation.id` を context として受け取り、Deployment に
  bind する (台帳本体は [Takosumi Accounts](./takosumi-accounts.md) 側)

browser / CLI 向け `/api/*`、Installed Takos の OIDC consumer session、
`/_takosumi/launch`、app-local settings は Takos app/API gateway の責務です。
kernel control はそれらの session state や callback/JWKS verification を所有しません。

## 実行コンポーネント

control plane の process role 構造は複数の独立した worker / container 単位に
展開される。process role としては:

- **kernel API process** — compiled manifest / Deployment / GroupHead /
  ProviderObservation / route projection の API と control-plane cron。
  OAuth/OIDC issuer、OIDC consumer callback、Stripe webhook、Takos chat UI は
  処理しない
- **dispatch process** — tenant routing process role。GroupHead が指す current
  Deployment の route projection を解決して tenant hostname → group worker /
  endpoint に振り分ける
- **background worker process** — deployment queue / provider operation queue /
  observation / recovery
- **runtime host process** — `takos-runtime-service` container を host / forward
  する backend-specific adapter process role
- **executor host process** — agent run の executor container を host する
  Takos product process role (`/architecture/container-hosts`)。kernel compute
  control の正本ではない

各 process role は backend-specific に複数 worker / Container 単位に materialize
される。tracked reference Workers backend での具体的な worker 名と container
class は本ページ末尾の collapsible 節を参照。

## CLI proxy loopback bypass

この節は Takos product の runtime-service compatibility path を説明する参考情報です。
kernel control の ownership ではありません。operator workstation の Takos CLI から
runtime-service の CLI-proxy endpoint (`/cli-proxy/*`) に到達する flow:

1. CLI が Takosumi Accounts bearer 付きで Takos app/API gateway に HTTPS POST
   する
2. Takos app/API gateway が Accounts bearer を issuer / introspection 経由で検証し
   app-local session を引く
3. Takos app/API gateway から runtime host process に internal binding で渡す
4. runtime host process が `/forward/cli-proxy/*` を container 内 loopback で
   呼ぶ
5. runtime-service が `X-Forwarded-For` ではなく実接続元 address (loopback)
   を判定し、allowlist の repo API path のみ session proxy token で runtime host
   に戻す
6. runtime host が proxy token を検証して Takos app/API gateway の
   `/api/repos/:id/(import|export|status|log|commit)` に中継する

詳細な header trust model / spoof 防止 / session vs space check は
[runtime-service § CLI-proxy loopback bypass](/architecture/runtime-service#cli-proxy-loopback-bypass)
を参照。tracked reference Workers backend での具体的な service binding や
container loopback 構造は本ページ末尾の collapsible 節を参照。

## Dispatch Namespace

tenant worker は backend-specific な dispatch namespace で論理分離される。
これは operator / backend 側の deployment detail であり、public CLI の
`takos deploy` / `takos install` には `--namespace` option は露出していない。
tracked reference Workers backend では Cloudflare dispatch namespace を使う
(本ページ末尾の collapsible 節を参照)。

## API surface

### Kernel API

kernel control が提供する API。account / OAuth issuer / billing API、Takos app
の browser/API gateway、OIDC consumer callback は本ページの対象外で、それらは
[Takosumi Accounts](./takosumi-accounts.md)、[AppInstallation 台帳](./app-installation.md)、
Takos app/API gateway の正本を参照。

- compiled manifest Deployment create / resolve / apply / status
- GroupHead management (advance / rollback / route projection)
- resource provider operation management
- service import descriptor pinning and output materialization
- usage event **emit** for kernel-managed resources (請求集計や invoice 計算は
  Takosumi Accounts 側)

### Group-provided API

group が自身の routes で提供する API。kernel の責務ではない。

例:

- MCP tools (third-party group)
- Document editing (takos-docs)
- Spreadsheet operations (takos-excel)

## 永続化の構成

### Kernel schema

kernel control が所有する DB schema。ここでの ownership は compiled manifest
apply と provider reconciliation に必要な state に限る。account / OAuth issuer /
billing 系の schema は kernel ではなく Takosumi Accounts (account plane) が所有する。

| schema group | responsibility                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| Spaces       | compute namespace / Space id reference。membership と app-local profile は Takos app / Takosumi Accounts 側       |
| Deployments  | Deployment input snapshot, desired state, status, conditions, operation WAL                                       |
| Groups       | GroupHead, deployment history pointer, rollback target                                                            |
| Resources    | resource claims, provider operations, resource outputs, secret refs                                               |
| Imports      | service import descriptor pins, resolver metadata, provider instance metadata                                     |
| Routing      | route projection, RoutingRecord, custom domain target materialization                                             |
| Platform     | kernel resource/session bookkeeping needed for provider reconciliation                                            |
| Metering     | kernel resource usage event emit (請求 invoice の materialize は Takosumi Accounts 側)                            |

Takos product features such as Agent / Chat, Git hosting, Storage, Store, app-local
sessions, and app-local workflows are not kernel schema ownership. They live in
their owning Takos product roots / services and may consume kernel outputs through
published APIs or AppInstallation bindings.

account plane が所有する schema (本ページ対象外):

| schema group         | owner             | responsibility                                                                                         |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| Accounts             | Takosumi Accounts | Takosumi Account, login, passkey, upstream IdP linkage                                                 |
| OAuth / OIDC         | Takosumi Accounts | OIDC issuer state, OIDC client registration, consent, token, pairwise sub                              |
| Billing              | Takosumi Accounts | billing account, Stripe subscription, invoice, usage aggregate                                         |
| AppInstallation 台帳 | Takosumi Accounts | AppInstallation / serviceImports metadata / AppBinding / AppGrant / RuntimeBinding / InstallationEvent |

## Deploy pipeline

kernel 外の primitive に適用される。docs, excel, slide, computer, yurucommu,
user-defined workloads は同じ primitive model で扱う。kernel の機能（agent, git,
storage, store）は kernel に統合済みであり、deploy pipeline の対象外。

```text
1. Parse manifest (.takosumi/manifest.yml) → Deployment.input.manifest_snapshot
2. Validate closed manifest envelope and `resources[]` entries
3. Resolve service imports through `serviceResolvers[]` anchors and pin
   descriptor digest / provider instance metadata
4. Compose desired state (resource claims / route projection /
   runtime_network_policy / activation_envelope)
   → Deployment.status を resolved に persist
5. Apply (status: resolved → applying)
   - provider operations を topological order で実行 (depends に従う)
   - 各 operation の進捗は Deployment.conditions[]
     (scope.kind="operation" / "phase") として記録
6. Materialize env / provider config from resource outputs and import outputs
7. status: applying → applied で activation_envelope を commit、GroupHead を
   advance (current_deployment_id を新 Deployment に向け、previous を保持)
8. Update routing (route projection を materialize)
```

### Deploy atomicity

deploy は以下の failure boundary を持つ。Core の atomic commit は Deployment の
`applying → applied` 遷移と GroupHead の `current_deployment_id` advance
であり、provider/router convergence の証明ではありません:

1. migration 失敗 → Deployment の `conditions[]` に failure を記録、 全体が
   `failed` に遷移。worker は起動しない
2. worker deploy 失敗 → GroupHead は前 Deployment を指したまま。前の deployment
   が serve 続行
3. routing update 失敗 → ProviderObservation として観測差分を残し、retry /
   repair は新 Deployment で扱う。`Deployment.desired.activation_envelope` は
   desired routed serving envelope であり、到達可能性の証明ではない

Service / Attached container の `healthCheck` は deploy target orchestrator
に渡す入力であり、kernel が deploy 後に定期監視するものではない。group apply
の結果に失敗が含まれる場合は `group.unhealthy` event を emit する。Worker は
manifest で health check を宣言しないが、kernel が deploy 時に `GET /` で
readiness を確認する（詳細は [Worker readiness](#worker-readiness)）。

### App-facing metadata lifecycle

MCP endpoint / file handler / app catalog entry などの app-facing metadata は
current kernel-bound manifest の top-level field ではありません。Takos app /
installer layer が AppInstallation と app metadata として管理し、kernel control
は metadata が参照する workload URL / route output を resource output として
返すだけです。

- deploy 時: kernel は `resources[]` を apply し、resource output / route
  projection を Deployment に記録する
- installer / Takos app 側: MCP / file handler / catalog metadata を
  AppInstallation と紐づけて保存する
- consumer 側: 必要な credential / endpoint は AppGrant / AppBinding / service
  import / resource output から明示的に materialize する

OIDC client は `identity.oidc@v1` AppBinding 経由で Takosumi Accounts が
installation 単位に発行する
([binding-catalog](/reference/binding-catalog#_1-identity-oidc-v1) 参照)。 Agent
/ Chat / Git / Storage / Store は Takos product service / app feature で
あり、takosumi kernel feature ではありません。

## Routing layer

routing は hostname → deployment/endpoint の解決を担う独立した層。Core 視点で は
GroupHead が指す current Deployment の `desired.routes` /
`desired.activation_envelope` から導出される route projection が canonical
source で、RoutingRecord はその materialization。hostname により control plane
と group runtime に振り分ける。

- kernel host (`{KERNEL_DOMAIN}`) → kernel API / health / deployment control
- auto hostname / custom slug / custom domain → dispatch process → group の
  worker

> auth (`/oauth/*`) は kernel host の routing 対象外です。OIDC issuer endpoint
> は [Takosumi Accounts](./takosumi-accounts.md) (`takosumi.account.auth@v1` を
> anchor resolve した operator endpoint) が serve します。

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
| Kernel host   | `{KERNEL_DOMAIN}`                                | 固定ロジック                      |

auto hostname / custom slug / custom domain の 3 つはすべて同じ
RoutingTarget（同じ group worker）を指す。

kernel host (`{KERNEL_DOMAIN}`) は RoutingRecord を使わず、ingress/edge の固定
ルールで kernel API process に routing される。group は RoutingRecord の
hostname を dispatch process が解決して routing される。

### Deploy 時の routing 更新

group deploy 時に kernel は:

1. manifest の routes から `Deployment.desired.routes` を compile し、
   `Deployment.desired.activation_envelope` で route assignment を組む
2. group の hostname に対して RoutingRecord を upsert する (route projection の
   materialization)
3. canary deploy の場合は `activation_envelope.route_assignments` の weight
   を設定する（active + canary の 2 target）

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
を返せない Worker（例: MCP-only endpoint）は component の `runtime.*` config の
`readiness` フィールドで override する。

routing 用の hostname / route がまだ割り当てられていない Worker は readiness
probe を skip する。

routing 切り替えはこの readiness 確認の後に行う。

canary deploy は routing weight を付けて開始するだけで、health 変化に応じた 自動
rollback はこの contract には含めない。rollback が必要な場合は canary abort /
rollback API で明示的に戻す。

### Route projection cache

route projection (GroupHead が指す Deployment.desired から導出) の解決は
backend-specific な cache 階層で高速化される。L1 isolate-local cache → L2 shared
store → L3 strongly consistent storage の基本構造を持ち、書き込みは L3 → L2 → L1
の順、読み取りは L1 → L2 → L3 の順で fallback する。

L1 は TTL ベースで更新される (最大 10 秒の staleness を許容)。deploy 直後は L1
が古い target を返す可能性がある。critical な routing 変更 (rollback 等) では L1
TTL を待つか dispatch process の再起動で L1 を flush する。

具体的な TTL / max entries / store 種別 (KV / DO 等) は本ページ末尾の
collapsible 節を参照。

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
invalid。route output は `outputs.*.routeRef` で route を参照するため、
`routes[].id` は manifest 内で一意でなければならない。manifest 全体で同じ
target/path が複数件に一致してはいけない。

### Dispatch の routing 境界

dispatch process は group レベルだけでなく、group 内の worker レベルまで routing
する。

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

1. Takosumi Accounts が起動し、OIDC issuer / AppInstallation API / billing plane
   が ready になる
2. kernel が起動する（compiled manifest API / provider adapters / routing が
   ready）
3. docs, excel, slide, computer, yurucommu は default app distribution
   の初期セット として preinstall 対象にできる。operator はこの app set
   を差し替えられる。 default set に含まれても primitive や group
   は特権化されない。
4. deploy 時に kernel が compiled `resources[]` と `imports[]` を解決し、
   resource output / service import output を env / provider config に
   materialize する（全 group 自動注入はしない）
5. deploy された workload が起動し、Takosumi Accounts OIDC issuer
   (`takosumi.account.auth@v1` を anchor resolve した endpoint) に対して ID
   token を検証できる状態になる

group は kernel が ready になるまで起動を待つ。kernel の readiness は kernel
control 自身の health endpoint で判定する。OIDC issuer の readiness は
[Takosumi Accounts](./takosumi-accounts.md) 側で別途検証する。

group が他 group の route output / service import に依存する場合、その group が
まだ deploy されていないと対応する endpoint / env 変数が存在しない。group は
これを graceful に扱う必要がある（エラーではなく、機能が利用不可の状態として
表示する）。

default app distribution に含まれる groups 間の output 依存は保証しない。初回
deploy / 利用開始直後は他 group の endpoint / env がまだ materialize されて
いない場合がある。各 group は graceful degradation で対処する（env が未設定でも
起動する）。

## Group deletion

group 削除時に kernel は以下を順に実行する:

1. routing を削除（RoutingRecord を tombstone）
2. resource output / service import materialization を revoke する
3. `group.deleted` event を発行
4. worker を停止
5. group record を削除

## Request flow

### kernel API

```text
takosumi-git / operator / Takos app gateway
  → {KERNEL_DOMAIN}/v1/deployments or kernel management endpoint
  → kernel API process
  → trusted caller / service token / Accounts-derived actor context verification
  → Deployment lifecycle / GroupHead / resource provider route family
```

Browser-facing Takos routes (`/_takosumi/launch`, `/auth/oidc/callback`,
`/settings`, chat SPA, public product API) は kernel API ではありません。OIDC
issuer / login UI / consent screen は
[Takosumi Accounts](./takosumi-accounts.md) (`takosumi.account.auth@v1`) が
serve し、OIDC consumer session は Installed Takos が扱います。

### group hostname → group runtime

```text
client
  → {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}/* (auto hostname)
  → dispatch process
  → hostname で group を特定（auto / custom slug / custom domain いずれも同じ）
  → group の worker → group logic
```

## Queue と stream

control plane は queue ベースの async work と stream ベースの notifier を
併用する。canonical な queue family は次のとおり:

- deployment queue: deploy pipeline の async step
- provider operation queue: provider API call / retry / recovery
- observation queue: drift observation / status projection refresh
- routing queue: route projection materialization / custom domain refresh

Agent run / app-local workflow / search index queue は Takos product feature の
queue であり、kernel control queue ではありません。

DLQ への rotate は max retries 超過時に行われる。replay は operator manual
で行う想定。具体的な queue 名 / max retries / DLQ 名は backend-specific
materialization detail として本ページ末尾の collapsible 節を参照。

stream / notifier 系は Deployment status notifier、provider observation notifier、
routing update notifier の 3 系統。routing storage、rate limiter、provider lock
などの infra も backend-specific な materialization で provide される。

### Cron schedules

control plane は 2 系統の cron family と、provider / routing 用の独立 cron を
運用する。

| family       | family jobs                                                                   |
| ------------ | ----------------------------------------------------------------------------- |
| quarter hour | custom domain reverify, stuck-domain reconcile, stuck Deployment observation  |
| hourly       | provider operation retry sweep, resource observation GC, routing tombstone GC |

`scheduled()` handler は `isQuarterHourCron(cron)` / `isHourlyCron(cron)` で
family を判定し、両方の cron 表記を同じ job に dispatch する。family job の
後、全 cron で common env scheduled maintenance と provider/routing maintenance
を実行する。

control-plane runtime worker は奇数分ごとに stale Deployment / provider operation
recovery を実行する。recovery は cron 文字列で branch せず、毎回 unconditional
に走る。

dev 環境では `POST /internal/scheduled?cron={form}` を loopback / cluster
hostname から叩くと同じ family 判定で HTTP 互換の maintenance job を実行できる
(`/internal/scheduled` endpoint)。`cron=* * * * *` は quarter hour / hourly の両
family をまとめて実行する。

backend-specific な cron expression / offset / trigger 設定の materialization
は本ページ末尾の collapsible 節を参照。

## DB migration

SQL schema 変更は resource / backend 側の migration として管理する。

### Migration の実行

backend 実装によっては SQL resource に対して migration を実行できる。public
manifest contract は schema 変更の実行手順を記述しない。resource API / runtime
binding と migration は backend 側で管理する。

### Rollback と migration

group deployment record には migration 状態が含まれる。rollback 時、kernel は
forward-only migration のみサポートする。schema
を巻き戻す必要がある場合は、新しい migration として書く。

migration が失敗した場合、deploy 全体が fail する。group の worker
は起動しない。

### Atomicity

group を指定した deploy の strong consistency boundary は group inventory
projection と GroupHead `current_deployment_id` の advance です。
ProviderObservation は Core canonical state ではなく、失敗時は
`Deployment.conditions[]` と retry/repair の新 Deployment で扱います。

- migration lock / `Deployment.desired` の commit / GroupHead advance は 1 つの
  group-scoped apply として整合させる
- migration 成功 → worker deploy 失敗 の場合、migration は rollback
  されない（forward-only）
- 代わりに `Deployment.conditions[]` が fail を記録し、Deployment は `failed`
  で終端、GroupHead は前 Deployment を指したままで前の route projection が serve
  され続ける
- 別の group の deploy には影響しない（group 間の deploy は独立）

## Workers backend reference materialization

::: details tracked reference Workers backend の実装詳細

> このセクションは Cloudflare Workers backend に固有の materialization
> detail。Core 用語との対応は
> [Glossary § Workers backend implementation note](/reference/glossary#workers-backend-implementation-note)
> を参照。

tracked reference Workers backend では、kernel control の process role は複数の
Cloudflare worker と Container DO に展開される。Installed Takos app/API gateway
worker は別 product surface として同じ distribution に同居し得るが、kernel
control role ではない。

### Worker 配置

```text
takosumi-git / operator / Takos app gateway
  → takosumi-kernel-api (Deployment API)
     → takosumi-kernel-dispatch (tenant routing)
     → takosumi-kernel-worker (provider/background jobs)
     → takos-runtime-host (backend adapter / runtime-service host)
```

#### `takosumi-kernel-api`

kernel API worker。`{KERNEL_DOMAIN}` の Workers backend 配備変数で serve。

- compiled manifest Deployment API
- provider operation / route projection control
- usage metering の emit (請求 / invoice の materialize は Takosumi Accounts 側)
- route registration と control-plane cron
- service import descriptor pinning / output materialize

Takos chat SPA、`/api/*` product gateway、`/_takosumi/launch`,
`/auth/oidc/callback`, `/settings`, setup UI は Installed Takos app/API gateway
worker の責務です。

#### `takosumi-kernel-dispatch`

tenant routing を受け持つ dispatch worker。tenant/custom host を group
に振り分ける。

- `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}` → group の worker（auto
  hostname）
- `{custom-slug}.{TENANT_BASE_DOMAIN}` → group の worker（custom slug）
- custom domain → group の worker

#### `takosumi-kernel-worker`

background worker。

- deployment queue
- provider operation queue
- observation / drift queue
- egress proxy where required by provider adapters
- background cron / recovery

#### `takos-runtime-host`

`runtime-host` は 2 つの文脈で使われる。

- backend-specific runtime で Worker `worker-bundle` を扱う deployment adapter
  名
- `takos-runtime-service` container を host / forward する Cloudflare worker

どちらの文脈でも、group の image-backed container workload を直接 materialize
する役割ではない。

`runtime.oci-container@v1` を ref に持つ component は OCI deployment adapter /
orchestrator 側で materialize される。子 component workload は current runtime
では worker-side binding で resolved endpoint に接続される。

### Cookie / session

Session cookie は host-only の `__Host-tp_session` として発行する（`Domain`
attribute なし）。kernel と group subdomain では cookie を共有しない。

### CLI proxy loopback bypass (Cloudflare 詳細)

CLI proxy flow を Cloudflare service binding と Container DO で展開した形:

```text
CLI on operator workstation
  │  ① HTTPS POST → Takos app/API gateway
  │     Authorization: Bearer <PAT>
  ▼
Takos app/API gateway worker
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
  │  ⑧ proxy token を検証して Takos app/API gateway に中継
  ▼
Takos app/API gateway worker
  │  ⑨ `/api/repos/:id/*`
  ▼
実 git/repo 処理
```

- ① → ②: Takos app/API gateway 側で Takosumi Accounts bearer を検証したうえで
  app-local session を引く
- ②: container mode では (3) のように service binding 経由で runtime-host を
  呼ぶ。これは worker bundle / runtime-service host 経路であり、container
  workload の materialization そのものではない。通常の direct HTTP mode では
  kernel から runtime-service の `/cli-proxy/*` を直接呼ぶ (loopback bypass は
  使わない)
- ③ → ④: `RUNTIME_HOST` service binding は Cloudflare worker binding なので、
  kernel → runtime-host は net hop を経由しない
- ④: `runtime-host` は container 内の deno process に loopback で到達する (CF
  Container DO は `127.0.0.1` を立てる)
- ⑤ → ⑥: runtime-service が実接続元を `127.0.0.1` / `::1` / `::ffff:127.0.0.1`
  と判定できる場合にだけ service-token JWT 不要の local bypass
  条件を満たす。`X-Forwarded-For` / `X-Real-IP` は trust boundary ではない。
  bypass 時も `X-Takos-Session-Id` は required で、session vs `X-Takos-Space-Id`
  の照合で space 分離が保たれる
- ⑦ → ⑨: runtime-service は repo 操作を直接実行せず、session の proxy token で
  runtime-host の `/forward/cli-proxy/*` に戻す。runtime-host が token
  を検証し、Takos app/API gateway の `/api/repos/:id/*` に中継する
- `X-Forwarded-For` の spoof 防止は **ingress 側の責務**: CF Container は
  外部から渡された header を丸ごと渡すので、kernel / runtime-host で header を
  strip する必要がある。bypass 経路全体の詳細は
  [runtime-service § CLI-proxy loopback bypass](/architecture/runtime-service#cli-proxy-loopback-bypass)
  を参照

### Dispatch namespace (Cloudflare)

tenant worker は tracked reference Workers backend では Cloudflare dispatch
namespace を使って論理分離される。public CLI には `--namespace` option は
露出していない。

### Routing layer (Cloudflare 詳細)

- 固定ルール: `{KERNEL_DOMAIN}` → `takosumi-kernel-api` (kernel Deployment API /
  health)
- auto hostname / custom slug / custom domain → `takosumi-kernel-dispatch` →
  group の worker

#### Multi-tier cache

routing 解決は 3 層キャッシュで高速化する。

```
L1: isolate-local Map (TTL 10s, max 2048 entries)
 ↓ miss
L2: KV namespace (TTL 90s)
 ↓ miss
L3: Durable Object (strong consistency, hostname でシャード)
```

write は DO → KV → L1 の順で伝播する。読み取りは L1 → KV → DO の順で fallback
する。L1 は LRU eviction で管理する。max entries を超えた場合は最も古い entry
を破棄する。大規模環境（多数の hostname）では L1 hit rate が下がるが、L2 (KV) が
fallback するため latency は許容範囲内。`RoutingDO` が L3 の strong-consistency
authority。

### Queue と stream (Cloudflare 詳細)

queue と DO ベースの notifier を併用する。

- queue: deployment, provider operation, observation, routing
- DO stream: Deployment status notifier, provider observation notifier, routing update notifier
- DO infra: routing, rate limiter, provider lock
- container DO: runtime host, executor host

各 queue には DLQ (`*-dlq`) が backend-specific worker config の
`[[queues.consumers]]` / equivalent queue config で設定されている。配送に
`max_retries` 回 (queue ごとに 2-3) 失敗した message は自動的に DLQ へ rotate
される。kernel 側で DLQ message を replay する仕組みは現状無く、operator
が手動で `wrangler queues consumer dlq move` する想定。

| queue                                      | max_retries | DLQ                           |
| ------------------------------------------ | ----------- | ----------------------------- |
| `DEPLOY_QUEUE` (`takosumi-deployments`)    | 3           | `takosumi-deployments-dlq`    |
| `PROVIDER_QUEUE` (`takosumi-providers`)    | 3           | `takosumi-providers-dlq`      |
| `OBSERVATION_QUEUE` (`takosumi-observe`)   | 2           | `takosumi-observe-dlq`        |
| `ROUTING_QUEUE` (`takosumi-route-updates`) | 3           | `takosumi-route-updates-dlq`  |

### Cron schedules (Cloudflare 詳細)

kernel API worker (`wrangler.toml [triggers]` equivalent) は 2 系統の cron を
運用する。Cloudflare の cron-storm window を避けるため offset を使用している:

| schedule (wrangler)  | dev / HTTP form | family       |
| -------------------- | --------------- | ------------ |
| `3,18,33,48 * * * *` | `*/15 * * * *`  | quarter hour |
| `5 * * * *`          | `0 * * * *`     | hourly       |

provider / routing worker は `1-59/2 * * * *` (奇数分ごと) で stale Deployment /
provider operation recovery を実行する。

### DB / persistence backing (Cloudflare 詳細)

control plane の永続化は tracked reference Workers backend では D1 / KV /
Durable Object / R2 / Vectorize を組み合わせて materialize する。各 schema group
の具体的な store mapping は wrangler.toml binding (
kernel distribution の backend-specific config) で定義される。

:::
