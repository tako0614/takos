# Kernel

::: tip Internal implementation このページは kernel の internal 実装を説明する。
public contract ではない。実装は変更される可能性がある。public contract は
[manifest spec](/reference/manifest-spec) と [API reference](/reference/api)
を参照。 :::

::: tip kernel = compute substrate
takosumi kernel は **manifest を apply するだけの compute substrate** です
(new.md §2.1, §17)。identity / billing / OAuth / workflow / cron / consent
screen / Stripe / app marketplace は kernel に **入れません**。これらは
[Takosumi Accounts](./takosumi-accounts.md) (account plane、service identifier
`takosumi.account.auth@v1` 経由で参照) と
[takosumi-git](./installer-pipeline.md) (上位 sibling product) の責務です。
全体モデルは [Installable App Model](./installable-app-model.md) を参照。
:::

::: warning kernel-pure / no service registry (invariant 18)
kernel は **service registry を持ちません**。 service identifier から
endpoint URL への resolution は manifest `serviceResolvers[]` で operator
が inject した anchor service が担当し、 kernel は signature verify +
descriptor pin metadata のみを行います。 durable audit append / cache refresh /
revoke は継続 work です。invariant 16 / 17 / 18 は
[core contract v1.0](/takosumi/core/01-core-contract-v1.0#_2-core-invariants)、
canonical 設計は
[cross-instance service binding](./cross-instance-service-binding.md) を参照。
:::

Takos は AI によるソフトウェア民主化基盤。kernel は Agent / Chat, Git, Storage,
Store を統合した単一のサービス。これらは kernel features であり、group では
ない。アンインストール不可。

kernel が serve する request は PaaS Core の Deployment / ProviderObservation /
GroupHead といった meta-objects に従って routing / activation / binding が
解決される。Deployment は authoring expansion → resolution
(`Deployment.resolution.descriptor_closure` / `.resolved_graph`) → desired
(`Deployment.desired.routes` / `.bindings` / `.resources` /
`.runtime_network_policy` / `.activation_envelope`) → conditions
(`Deployment.conditions[]`) の 4 layer を 1 record に内包する。Core の normative
定義は
[`takosumi/core/01-core-contract-v1.0.md`](/takosumi/core/01-core-contract-v1.0)
を、用語表は [Glossary § Core meta-objects](/reference/glossary) を参照。

## Takos の定義

AI agent がソフトウェアを作り・管理し・配布する基盤。以下は **kernel
features**（常時提供、削除・差し替え不可）:

- **Agent / Chat**: AI との対話でソフトウェアを開発・運用
- **Git**: コード管理
- **Storage**: ファイル管理
- **Store**: catalog app / package の検索・配布・Store Network
- **Deploy**: external group のデプロイ pipeline
- **Routing**: hostname → workload の解決と外部公開
- **Resources**: sql, object-store, key-value 等のリソース管理

`Auth` と `Billing` は **kernel features に含めません**。Auth/identity は
[Takosumi Accounts](./takosumi-accounts.md) (OIDC issuer / upstream IdP broker)
が、Billing も Takosumi Accounts (billing owner) が責務を持ちます。Installed
Takos は Takosumi Accounts の OIDC を `AUTH_DRIVER=oidc` として consume するだけ
で、kernel 自身は OAuth/OIDC を発行しません。

kernel が持たないもの (Installable App Model の不変条件):

- user account / login / passkey
- billing / Stripe / subscription / invoice
- OAuth / OIDC issuer / consent screen
- AppInstallation 台帳 / app marketplace
- workflow / build pipeline / cron / scheduler
- group 固有の UI
- group 固有の DB schema
- group 固有の queue や background job

kernel が compute に専念するため、上記は次の owner に集約されます。

```text
identity / billing / OAuth / AppInstallation : Takosumi Accounts
workflow / .takosumi/app.yml / build / install : takosumi-git
chat / agent / memory / app-local profile     : Installed Takos (takos-app)
```

## Space

space は **Takosumi Account 配下の install scope** です。tenant (契約・billing
主体) は **Takosumi Account** であり、Space はその下に並ぶ install scope
です。Installable App Model の階層は次のとおり (glossary / new.md §21 と整合):

```text
Takosumi Account  (契約 / billing / identity owner)
  └── Space       (install scope, kind: personal / team / org)
        └── AppInstallation  (Takos などの app の installation 単位)
```

- Takosumi Account = 契約・billing・identity の owner (tenant 主体)
- Space は Takosumi Account 配下の **install scope** であり、`personal` /
  `team` / `org` の kind を持つ
- AppInstallation は Space に属し、Space は AppInstallation の親になる
- compute / data / routing は Space 単位で分離される
- user は Takosumi Account の identity を持ち、Space を通じて AppInstallation
  にアクセスする
- Space の切り替えは UI / session で行う (domain ではない)

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
model を説明するときは primitive / group を使う。canonical manifest は
`.takosumi/manifest.yml` (旧 `.takos/app.yml` / `.takos/app.yaml` は deprecated alias、後方互換のため受理)。

### `.takosumi/manifest.yml`

primitive desired declaration を書く flat YAML。 envelope なし、全 field が
トップレベル。 ファイル名には `app` が残るが、 deploy model では Core 入力
(AppSpec / EnvSpec / PolicySpec) を 1 ファイルで宣言する deploy manifest と
して扱う。

トップレベルは Core 語彙のみ:

| field          | 役割                                                            |
| -------------- | --------------------------------------------------------------- |
| `name`         | display 名。 deploy / install では既定の group 名にもなる       |
| `components`   | 名前付き component declaration map (各 component は contracts map を持つ) |
| `routes`       | exposure ↔ listener / match / transport binding                 |
| `resources`    | resource claim map                                              |
| `bindings`     | consumer ↔ source の explicit binding edge                      |
| `publications` | typed outputs publication catalog                               |
| `environments` | EnvSpec hooks                                                   |
| `policy`       | PolicySpec hooks                                                |

`worker` / `service` / `attached container` / `compute` / `triggers` /
`consume` といった旧 authoring 語彙は manifest 表面には出ない。 全ての
具体性は `ref: <descriptor>` (`runtime.js-worker@v1` /
`runtime.oci-container@v1` / `interface.http@v1` / `resource.sql.postgres@v1`
等) と descriptor schema に従う `config:` で表現する。

resource 自体は control-plane managed backing capability として扱う。SQL /
object-store / queue などの resource API / runtime binding は publications
catalog と分ける。 publication は injection を含意せず、 binding は
`bindings[]` で **明示** する (Core invariant 4 / 7)。

normative な field 仕様は [manifest spec](/reference/manifest-spec) を参照。

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
  /settings  → dashboard

Groups (routing layer で hostname 割り当て):
  group は最大 3 つの hostname を持てる:

  1. auto:          {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}（常に存在、衝突しない）
  2. custom slug:   {custom-slug}.{TENANT_BASE_DOMAIN}（optional、globally unique）
  3. custom domain: 任意のドメイン（optional、DNS 検証）
```

OAuth / OIDC の login flow は kernel 内ではなく
[Takosumi Accounts](./takosumi-accounts.md) (`accounts.takosumi.cloud`) で扱われ
ます。kernel は `/auth/*` 系の OAuth issuer endpoint を **持ちません**。Installed
Takos は OIDC consumer として Takosumi Accounts に redirect し、callback path
(`/auth/oidc/callback` 等) のみを受けます。

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
  typed outputs catalog に使い、Takos API key は built-in provider publication
  として consume する (OIDC client は publication ではなく
  `identity.oidc@v1` AppBinding 経由で installation 単位に発行される、
  [binding-catalog](/reference/binding-catalog#_1-identity-oidc-v1) 参照)

resource は ResourceInstance として control plane が record し、Deployment や
provider の lifecycle と independent な durable record を持つ。provider 側の
observed state は ProviderObservation stream として記録され、canonical な真値
は常に Deployment.desired 側にある。compute への接続は
`Deployment.desired.bindings` field に Deployment 単位で固定される。

kernel 自身の storage は kernel DB / object-store を使う（group とは別）。

## Publication / Binding と env injection

group が manifest で `publications` を宣言すると、 deploy 時に kernel が
typed outputs publication catalog を保存する。 publication は injection を
含意せず (Core invariant 4)、 consumer は `bindings[].from.publication` で
**明示** に consume する。 Takos API key は `publications[]` ではなく
`takos.api-key` built-in provider publication として `bindings[]` で
consume する。 OIDC client は publication ではなく `identity.oidc@v1`
AppBinding 経由で installation 単位に発行される
([binding-catalog](/reference/binding-catalog#_1-identity-oidc-v1) 参照)。

### route publication

route publication は group が公開する interface の metadata。 Takos 標準
descriptor は `publication.http-endpoint@v1` / `publication.app-launcher@v1`
/ `publication.file-handler@v1` / `publication.mcp-server@v1` 等の
namespaced ref で、 core は platform-managed behavior 以外の metadata を
解釈しない。

```yaml
publications:
  - name: tools
    ref: publication.mcp-server@v1
    outputs:
      url: { from: { route: mcp } }
    spec:
      transport: streamable-http
  - name: docs
    ref: publication.app-launcher@v1
    outputs:
      url: { from: { route: ui } }
    metadata:
      display:
        title: Docs
        icon: /icons/docs.svg
        category: office
```

必須 field:

- `name`
- `ref`
- `outputs`

### Takos built-in provider publication

Takos API key は built-in provider publication として `bindings[]` で
consume する。 OIDC client は publication ではなく
`identity.oidc@v1` AppBinding 経由で installation 単位に発行される
([binding-catalog](/reference/binding-catalog#_1-identity-oidc-v1) 参照)。

```yaml
bindings:
  - from:
      publication: takos.api-key
      request:
        scopes: [files:read]
    to:
      component: web
      env:
        TAKOS_API_URL: endpoint
        TAKOS_TOKEN: apiKey
```

必須 field:

- `from.publication`
- `from.request`
- `to.component`
- `to.env`

`request` は provider ごとの required / optional field が変わる。 route
publication の URL は assigned hostname と output `from: { route: <id> }` が
参照する route の `path` から生成され、 path template は template URL のまま
扱う。 Takos built-in provider publication は provider が定義する outputs を
consumer ごとに env へ変換する。

deploy 時に kernel は:

1. manifest の `publications` を読み、 publication catalog を保存
2. route publication の auto-hostname URL、 Takos built-in provider
   publication outputs を解決する
3. `bindings[].from.publication` を宣言した consumer にだけ env / runtime
   binding として渡す

kernel features (Agent / Chat, Git, Storage, Store, Deploy, Routing, Resources)
は publication ではなく kernel API として直接提供される。Auth / identity は
kernel features ではなく [Takosumi Accounts](./takosumi-accounts.md) の OIDC
issuer 経由で consume する。

### Scope enforcement

各 component は独立した実行単位であり、 kernel は component 間の通信内容に
介入しない。 scope enforcement は受信側 group の責務。

## Capability credentials

Takos API access (`takos.api-key`) や OIDC consumer 統合 (`identity.oidc@v1`
AppBinding) は app-label 専用の特殊機構ではなく system built-in provider
publication または AppBinding として扱う。 `bindings[]` で request する。

```yaml
bindings:
  - from:
      publication: takos.api-key
      request:
        scopes: [files:read]
    to:
      component: web
      env:
        INTERNAL_TAKOS_API_URL: endpoint
        INTERNAL_TAKOS_API_KEY: apiKey
```

kernel は built-in provider publication outputs を解決するが、 consumer が
要求していない publication は inject しない。

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

## 関連ページ

kernel が **持たない** 領域は次の正本で扱われる:

- [Installable App Model](./installable-app-model.md) — Takos が "Git URL から
  Takosumi Account に install される app" であることの全体モデル。本ページの
  上位 canonical reference。
- [Takosumi Accounts](./takosumi-accounts.md) — OAuth / OIDC issuer / billing /
  upstream IdP broker。`/oauth/*` / `/auth/login` / consent screen はこちらが
  正本。
- [AppInstallation 台帳](./app-installation.md) — 所有権の primitive。
  AppInstallation / AppBinding / AppGrant / RuntimeBinding /
  InstallationEvent。
- [Installer Pipeline](./installer-pipeline.md) — `takosumi-git` (上位 sibling
  product) の Git URL installer / workflow runner / manifest compiler。
  `.takosumi/app.yml` と `.takosumi/workflows/*.yml` は kernel ではなく
  installer 側で解釈される。
- [Runtime Modes](./runtime-modes.md) — shared-cell / dedicated / self-hosted
  の 3 mode 比較。kernel は同じ compiled manifest を mode 越しに apply する。
- [Control Plane](./control-plane.md) — kernel control 面 (manifest apply /
  provider DAG / resource resolution) の実装。account plane (Takosumi Accounts)
  とは別レイヤー。
