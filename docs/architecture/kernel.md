# Kernel

::: tip Internal implementation このページは kernel の internal 実装を説明する。
public contract ではない。実装は変更される可能性がある。public contract は
[manifest spec](/reference/manifest-spec) と [API reference](/reference/api)
を参照。 :::

Takos は AI によるソフトウェア民主化基盤。kernel は Agent / Chat, Git, Storage,
Store, Auth を統合した単一のサービス。これらは kernel features であり、group
ではない。アンインストール不可。

kernel が serve する request は PaaS Core の Deployment / ProviderObservation /
GroupHead といった meta-objects に従って routing / activation / binding が
解決される。Deployment は authoring expansion → resolution
(`Deployment.resolution.descriptor_closure` / `.resolved_graph`) → desired
(`Deployment.desired.routes` / `.bindings` / `.resources` /
`.runtime_network_policy` / `.activation_envelope`) → conditions
(`Deployment.conditions[]`) の 4 layer を 1 record に内包する。Core の normative
定義は
[`takos-paas/core/01-core-contract-v1.0.md`](/takos-paas/core/01-core-contract-v1.0)
を、用語表は [Glossary § Core meta-objects](/reference/glossary) を参照。

## Takos の定義

AI agent がソフトウェアを作り・管理し・配布する基盤。以下は **kernel
features**（常時提供、削除・差し替え不可）:

- **Agent / Chat**: AI との対話でソフトウェアを開発・運用
- **Git**: コード管理
- **Storage**: ファイル管理
- **Store**: catalog app / package の検索・配布・Store Network
- **Auth**: 認証・認可
- **Dashboard**: space 管理
- **Deploy / Routing**: external group のデプロイと公開
- **Resources**: sql, object-store, key-value 等のリソース管理
- **Billing**: 課金

kernel が持たないもの:

- group 固有の UI
- group 固有の DB schema
- group 固有の queue や background job

## Space

space は Takos の分離単位。法人のようなもの。

- 1 space = 1 tenant
- user は space に所属する
- compute, data, routing が space 単位で分離される
- Space の切り替えは UI / session で行う（domain ではない）

## Primitive と group

外部ワークロードは **primitive-first deploy model** で構成される:

- **Primitive** — service / deployment / route / publication / resource /
  consume edge などの authoring/API projection
- **Group** — primitive を任意に束ねる state scope。所属 primitive は
  inventory、snapshot、rollback、uninstall などの group 機能を使える
- **Workload** — worker / service (常設 container) / attached
  container。内部では `services` / `deployments` に保存され、consume は各
  compute の中で宣言する
- **Resource** — sql / object-store / key-value / queue / vector-index / secret
  / analytics-engine / workflow / durable-object。内部では `resources`
  に保存され、group 所属の有無で CRUD / runtime binding の扱いは変わらない
- **Route / publication** — hostname/path → workload のマッピングと外部
  interface の公開情報

CLI は manifest / repository / catalog source から primitive declaration を
apply し、API は個別 primitive の管理もサポートする。primitive の desired state
は Deployment record の `desired` field に固定され、status が `resolved` →
`applying` → `applied` と遷移する。Deployment が `applied` になると GroupHead の
`current_deployment_id` がその Deployment を指し、kernel はそれを current として
serve する。

group は kernel features ではない (agent, git, storage, store は kernel 機能で
あり group ではない)。"app" は Store / UI 上の product label であり、deploy
model を説明するときは primitive / group を使う。manifest の互換ファイル名は
`.takos/app.yml` / `.takos/app.yaml`。

### `.takos/app.yml` / `.takos/app.yaml`

primitive desired declaration を書く flat YAML。envelope なし、全 field
がトップレベル。ファイル名には `app` が残るが、deploy model では deploy manifest
として扱う。

| field          | 役割                                                          |
| -------------- | ------------------------------------------------------------- |
| `name`         | display 名。deploy / install では既定の group 名にもなる      |
| `compute`      | worker, service, attached container (consume は各 compute 内) |
| `routes`       | path → workload のマッピング                                  |
| `publications` | typed outputs publication catalog                             |

resource 自体は control-plane managed backing capability として扱う。SQL /
object-store / queue などの resource API / runtime binding は publications
catalog と分ける。

### Default app distribution

default app distribution の初期セットは以下の 5 つ。新規 space の bootstrap で
preinstall できるが、operator は別の app set に差し替えられる:

- takos-docs
- takos-excel
- takos-slide
- takos-computer
- yurucommu

default set に含まれても、primitive や group は特権化されない。

### Lifecycle

install → deploy → reconcile → rollback → uninstall

kernel は group 機能と primitive の個別管理を両方扱う。

## Routing

kernel は `{KERNEL_DOMAIN}` で serve する。group は routing layer で独自の
hostname を持つ:

```text
Kernel ({KERNEL_DOMAIN}):
  /          → chat UI (SPA)
  /api/*     → kernel API
  /auth/*    → OAuth, session
  /settings  → dashboard

Groups (routing layer で hostname 割り当て):
  group は最大 3 つの hostname を持てる:

  1. auto:          {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}（常に存在、衝突しない）
  2. custom slug:   {custom-slug}.{TENANT_BASE_DOMAIN}（optional、globally unique）
  3. custom domain: 任意のドメイン（optional、DNS 検証）
```

Session cookie は host-only として発行する（`Domain` attribute なし）。kernel と
group subdomain では cookie を共有しない。

routing layer は GroupHead が指す current Deployment の `desired.routes` /
`desired.activation_envelope` から導出される route projection を解決し、
hostname で kernel か group に振り分ける。group 内に複数 worker がある場合は
path + method で適切な worker を選ぶ。

routing の実装詳細と route projection の cache / dispatch process role は
[Control Plane - Routing layer](./control-plane.md#routing-layer) を参照。

## Resource broker

kernel は compute に対する resource / publication の解決を行う。

- sql, object-store, key-value, queue, vector-index, secret, analytics-engine,
  workflow, durable-object
- resource は space 単位で分離される
- resource access は resource API / runtime binding で扱う。publications は
  typed outputs catalog に使い、Takos API key / OAuth client は built-in
  provider publication として consume する

resource は ResourceInstance として control plane が record し、Deployment や
provider の lifecycle と independent な durable record を持つ。provider 側の
observed state は ProviderObservation stream として記録され、canonical な真値
は常に Deployment.desired 側にある。compute への接続は
`Deployment.desired.bindings` field に Deployment 単位で固定される。

kernel 自身の storage は kernel DB / object-store を使う（group とは別）。

## Publication / Consume と env injection

group が manifest で `publications` を宣言すると、deploy 時に kernel が typed
outputs publication catalog を保存し、`compute.<name>.consume` を宣言した
consumer にだけ env を inject する。route publication は manifest の `type` +
`outputs` を基準とする。 Takos API key / OAuth client は `publications[]`
ではなく `takos.api-key` / `takos.oauth-client` built-in provider publication
として consume する。

### route publication

route publication は group が公開する interface の metadata。Takos 標準 `type`
は namespaced string で、core は platform-managed behavior 以外の metadata
を解釈しない。

```yaml
publications:
  - name: tools
    type: publication.mcp-server@v1
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http
  - name: docs
    type: publication.http-endpoint@v1
    display:
      title: Docs
      icon: book
    outputs:
      url:
        kind: url
        routeRef: ui
```

必須 field:

- `name`
- `type`
- `outputs`

### Takos built-in provider publication

Takos API key / OAuth client は built-in provider publication として consume
する。

```yaml
consume:
  - publication: takos.api-key
    as: takos-api
    request:
      scopes:
        - files:read
```

必須 field:

- `publication`
- `request`

`request` は provider ごとの required / optional field が変わる。route
publication の URL は assigned hostname と `outputs.*.routeRef` が参照する route
の `path` から生成され、path template は template URL のまま扱う。Takos built-in
provider publication は provider が定義する outputs を consumer ごとに env
へ変換する。

deploy 時に kernel は:

1. manifest の `publications` を読む
2. publication catalog を保存する
3. route publication の auto-hostname URL、Takos built-in provider publication
   outputs を解決する
4. `compute.<name>.consume` を宣言した consumer にだけ env として渡す

kernel features (Agent / Chat, Git, Store, Auth) は publication ではなく kernel
API として直接提供される。

### Scope enforcement

worker は独立した実行単位であり、kernel は worker 間の通信内容に介入しない。
scope enforcement は受信側 group の責務。

## Capability credentials

Takos API access や OAuth client は app-label 専用の特殊機構ではなく system
built-in provider publication として扱う。`compute.<name>.consume` で request
する。

```yaml
compute:
  web:
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
        inject:
          env:
            endpoint: INTERNAL_TAKOS_API_URL
            apiKey: INTERNAL_TAKOS_API_KEY
```

kernel は built-in provider publication outputs を解決するが、consumer
が要求して いない publication は inject しない。

## Dashboard

kernel が `/settings` で提供する space 管理 UI。kernel SPA
の一部として統合。group 一覧、deploy/rollback、resource 管理、member 管理。

## Event bus

kernel は `/api/events` で space 内の group 間イベント通知を提供する。

fire-and-forget。配信保証はない。

kernel が発行するイベント:

- `group.deployed`, `group.deleted`, `group.rollback`, `group.unhealthy`

Event 処理の原則: idempotent, graceful, non-blocking。

## Workers backend reference materialization

::: details tracked reference Workers backend の実装詳細

> このセクションは Cloudflare Workers backend に固有の materialization
> detail。Core 用語との対応は
> [Glossary § Workers backend implementation note](/reference/glossary#workers-backend-implementation-note)
> を参照。

tracked reference Workers backend では、kernel は admin host と tenant hostname
を分離した複数 worker / Container DO に展開される。

- kernel host (`{KERNEL_DOMAIN}` に対応する `{ADMIN_DOMAIN}` 配備変数) は
  control-web worker が serve する
- session cookie は host-only `__Host-tp_session` として発行する。kernel と
  tenant hostname で cookie を共有しない
- tenant hostname (auto / custom slug / custom domain) は `takos-dispatch`
  worker が受け取り、RoutingRecord の hostname → group worker / endpoint
  解決を行う。RoutingRecord は GroupHead が指す Deployment の `desired.routes` /
  `desired.activation_envelope` から導出した route projection の Workers backend
  側 record
- group 内に複数 worker がある場合、`takos-dispatch` が RoutingRecord の path
  - method で適切な worker を選ぶ
- route projection の解決は `RoutingDO` を底にした 3 階層 cache (L1 isolate Map
  / L2 KV / L3 DO) を経由する
- 配備設定は `takos/app/apps/control/wrangler.toml` 系の wrangler.toml ファイル
  に配置する

詳細な実行コンポーネント / cache 構造 / dispatch namespace は
[Control plane § Workers backend reference materialization](./control-plane.md#workers-backend-reference-materialization)
を参照。

:::
