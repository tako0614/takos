# Kernel

> **Internal implementation**
>
> このページは kernel の internal 実装を説明する。public contract
> ではない。実装は変更される可能性がある。public contract は
> [manifest spec](/reference/manifest-spec) と [API reference](/reference/api)
> を参照。

> **kernel = compute substrate**
>
> takosumi kernel は **manifest を apply するだけの compute substrate** です。
> identity / billing / OAuth / workflow / cron / consent screen / Stripe / app
> marketplace は kernel に **入れません**。これらは
> [Takosumi Accounts](./takosumi-accounts.md) (account plane、service identifier
> `takosumi.account.auth@v1` 経由で参照) と
> [takosumi-git](./installer-pipeline.md) (上位 sibling product) の責務です。
> 全体モデルは [Installable App Model](./installable-app-model.md) を参照。

> **kernel-pure / no service registry**
>
> kernel は **service registry を持ちません**。service identifier から endpoint
> URL への resolution は manifest `serviceResolvers[]` で operator が inject
> した anchor service が担当し、kernel は signature verify と descriptor pin
> metadata のみを行います。durable audit append / cache refresh / revoke は継続
> work です。invariant 16 / 17 / 18 は
> [core contract v1.0](/takosumi/core/01-core-contract-v1.0#_2-core-invariants)、
> canonical 設計は
> [cross-instance service binding](./cross-instance-service-binding.md) を参照。

kernel が serve する request は、compiled manifest を起点にした Deployment
lifecycle に従って routing / activation / resource wiring が解決される。
Deployment は input manifest、resource DAG、provider operation、conditions / WAL
を 1 lifecycle として扱う中核 record です。現行の manifest surface は
`apiVersion: "1.0"` + `kind: Manifest` + `resources[]` の Shape model です。
Core の normative 定義は
[`takosumi/core/01-core-contract-v1.0.md`](/takosumi/core/01-core-contract-v1.0)
を、用語表は [Glossary § Core meta-objects](/reference/glossary) を参照。

## Takos と kernel の境界

Takos は AI agent がソフトウェアを作り・管理し・配布する product です。ただし
Agent / Chat、Git hosting、Storage、Store、public API gateway は Takos product
側の service / app feature であり、takosumi kernel には入りません。kernel が
持つのは compute manifest apply、routing projection、resource provisioning、
provider reconciliation です。

`Auth` と `Billing` も kernel features に含めません。Auth/identity は
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
- Space は Takosumi Account 配下の **install scope** であり、`personal` / `team`
  / `org` の kind を持つ
- AppInstallation は Space に属し、Space は AppInstallation の親になる
- compute / data / routing は Space 単位で分離される
- user は Takosumi Account の identity を持ち、Space を通じて AppInstallation
  にアクセスする
- Space の切り替えは UI / session で行う (domain ではない)

## Resource と group

外部ワークロードは Shape resource の集合として apply される:

- **ManifestResource**: `shape` / `name` / `provider` / `spec` を持つ apply
  単位。例 `worker@v1` / `web-service@v1` / `database-postgres@v1`
- **Group**: deployment history と current pointer を束ねる state scope。
  GroupHead が `current_deployment_id` / `previous_deployment_id` を持つ
- **Workload shape**: executable resource。`worker@v1` と `web-service@v1`
  が現在の基本形
- **Backing resource shape**: database / object-store / secret などの managed
  capability。`database-postgres@v1` / `object-store@v1` など
- **Entrypoint**: `worker@v1.spec.routes`、`web-service@v1.spec.domains`、
  `custom-domain@v1` など、Shape spec から生成される routing projection
- **Service import**: cross-instance dependency。`imports[]` と
  `serviceResolvers[]` で service identifier を resolver anchor に結びつける

Deployment が `applied` になると GroupHead の `current_deployment_id` がその
Deployment を指し、kernel はそれを current として serve する。group に所属して
いるかどうかで shape / provider の apply semantics は変わらない。

"app" は Store / UI 上の product label であり、kernel-bound deploy model を説明
するときは ManifestResource / Group / Deployment を使う。canonical authoring
manifest は `.takosumi/manifest.yml` です。`.takosumi/app.yml` は takosumi-git /
installer が読む install manifest で、kernel-bound manifest ではありません。

### `.takosumi/manifest.yml`

compiled Shape manifest を書く YAML。top-level envelope は closed set で、
`apiVersion: "1.0"` と `kind: Manifest` が必須です。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: my-app
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:0123456789abcdef
      compatibilityDate: "2026-05-09"
      routes:
        - my-app.example.com/*
```

top-level `components` / `routes` / `bindings` / `publications` / `environments`
/ `policy` を持つ旧 AppSpec は current manifest ではありません。resource 間
dependency は `${ref:<resource>.<field>}` / `${secret-ref:<resource>.<field>}`
で表現します。installer-only placeholder (`${bindings.*}` / `${secrets.*}` /
`${artifacts.*}` 等) は current takosumi-git が未解決なら compile error にし、
`workflowRef` は kernel に渡す前に strip します。

normative な field 仕様は [manifest spec](/reference/manifest-spec) を参照。

### Default app distribution

default app distribution の初期セットは以下の 5 つ。新規 space の bootstrap で
preinstall できるが、operator は別の app set に差し替えられる:

- takos-docs
- takos-excel
- takos-slide
- takos-computer
- yurucommu

default set に含まれても、resource や group は特権化されない。

### Lifecycle

install は Takosumi Accounts / takosumi-git 側の AppInstallation lifecycle
です。kernel は compiled manifest を `POST /v1/deployments` で受け取り、deploy →
reconcile → rollback → uninstall の compute lifecycle を扱う。

rollback / uninstall は GroupHead の current pointer と provider state を
Deployment 単位で更新する。個別 resource の provider operation は Deployment
apply の DAG の中で扱われる。

## Routing

kernel は `{KERNEL_DOMAIN}` で control API を serve する。group は routing layer
で独自の hostname を持つ:

```text
Kernel ({KERNEL_DOMAIN}):
  /v1/deployments → compiled manifest apply API
  /healthz        → health check

Groups (routing layer で hostname 割り当て):
  group は最大 3 つの hostname を持てる:

  1. auto:          {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}（常に存在、衝突しない）
  2. custom slug:   {custom-slug}.{TENANT_BASE_DOMAIN}（optional、globally unique）
  3. custom domain: 任意のドメイン（optional、DNS 検証）
```

OAuth / OIDC の login flow は kernel 内ではなく
[Takosumi Accounts](./takosumi-accounts.md) で扱われます。consumer は
`takosumi.account.auth@v1` を `serviceResolvers[]` の anchor で resolve し、
operator-injected issuer endpoint に redirect します。kernel は `/auth/*` 系の
OAuth issuer endpoint を **持ちません**。Installed Takos は OIDC consumer として
Takosumi Accounts に redirect し、callback path (`/auth/oidc/callback` 等)
のみを受けます。

Installed Takos 側で session cookie を発行する場合は host-only とし（`Domain`
attribute なし）、kernel と group subdomain では cookie を共有しない。

routing layer は GroupHead が指す current Deployment の Shape resources から
導出される route projection を解決し、hostname で kernel か group に振り分ける。
projection は `worker@v1.spec.routes`、`web-service@v1.spec.domains`、
`custom-domain@v1` などから provider ごとに生成される。group 内に複数 entrypoint
がある場合は hostname / path / method で適切な workload を選ぶ。

routing の実装詳細と route projection の cache / dispatch process role は
[Control Plane - Routing layer](./control-plane.md#routing-layer) を参照。

## Resource broker

kernel は `resources[]` に宣言された ManifestResource を provider operation に
解決する。

- workload: `worker@v1` / `web-service@v1`
- backing resource: `database-postgres@v1` / `object-store@v1` / secret /
  provider-specific managed resource
- entrypoint: `worker@v1.spec.routes` / `web-service@v1.spec.domains` /
  `custom-domain@v1`
- resource は space / group 単位で分離される

resource は ResourceInstance として control plane が record し、Deployment や
provider の lifecycle と independent な durable record を持つ。provider 側の
observed state は ProviderObservation stream として記録され、canonical な
desired state は compiled manifest の resource entry です。compute への接続は
resource spec 内の env / binding / provider config に materialize される。

```yaml
resources:
  - shape: database-postgres@v1
    name: db
    provider: "@takos/aws-rds"
    spec:
      version: "16"
      size: small

  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        DATABASE_URL: ${ref:db.connectionString}
        DB_PASSWORD: ${secret-ref:db.passwordSecretRef}
```

kernel 自身の storage は kernel DB / object-store を使う（group とは別）。

## Service imports / AppBinding / env materialization

current kernel-bound manifest に top-level `publications[]` / `bindings[]`
はありません。runtime env は Shape resource の `spec.env` などに materialize
された値、 `${ref:...}` / `${secret-ref:...}`、または cross-instance service
import の `${imports...}` placeholder で表現する。

### Cross-instance service import

external service dependency は `imports[]` と `serviceResolvers[]`
で表現します。 consumer manifest は service identifier を参照し、Accounts
hostname を直接 pin しません。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: takos
imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
    refreshPolicy:
      kind: ttl
      ttl: 300s
serviceResolvers:
  - kind: anchor
    url: https://anchor.example.com/v1/services/
    publicKey: BASE64_ED25519_PUBLIC_KEY
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takos/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
```

kernel は anchor から provider-signed `ServiceDescriptor` を取得し、signature /
contract version / expiry を検証し、descriptor digest と provider instance を
audit pin として resource metadata / WAL に残します。kernel は global service
registry を持ちません。

### AppBinding

Installable App Model の `.takosumi/app.yml` の `bindings:` (`identity.oidc@v1`
/ `database.postgres@v1` / `object-store.s3-compatible@v1` 等) は
installer-bound です。current takosumi-git は unresolved `${bindings.*}` /
`${secrets.*}` を kernel に渡さず、compile error にします。OIDC client は
`identity.oidc@v1` AppBinding 経由で installation 単位に発行されます
([binding-catalog](/reference/binding-catalog#_1-identity-oidc-v1) 参照)。

Takos API access は Takos product API / AppGrant の責務です。kernel は
`takos.api-key` の publication catalog や top-level `bindings[]` env injection
を current manifest contract として扱いません。

### Scope enforcement

各 workload resource は独立した実行単位であり、kernel は workload 間の通信内容に
介入しない。scope enforcement は受信側 service / product API の責務です。

## Dashboard

space 管理 UI は Installed Takos / Takosumi Accounts 側の product surface です。
kernel は dashboard SPA を持たず、compiled manifest apply と provider
reconciliation の API に専念する。group 一覧、install、billing、member 管理は
account plane / product app の責務です。

## Event bus

kernel event は Deployment / provider lifecycle の internal stream として扱う。
product app 向けの `/api/events` や group 間通知は Installed Takos 側の API
surface であり、kernel public contract ではありません。

fire-and-forget。配信保証はない。

kernel internal event の例:

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
  解決を行う。RoutingRecord は GroupHead が指す Deployment の Shape resources
  から導出した route projection の Workers backend 側 record
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
  upstream IdP broker。OAuth provider / consent screen / upstream IdP login の
  正本。Takos の `/auth/login` は公開 route ではない。
- [AppInstallation 台帳](./app-installation.md) — 所有権の primitive。
  AppInstallation / serviceImports metadata / AppBinding / AppGrant /
  RuntimeBinding / InstallationEvent。
- [Installer Pipeline](./installer-pipeline.md) — `takosumi-git` (上位 sibling
  product) の Git URL installer / workflow runner / manifest compiler。
  `.takosumi/app.yml` と `.takosumi/workflows/*.yml` は kernel ではなく
  installer 側で解釈される。
- [Runtime Modes](./runtime-modes.md) — shared-cell / dedicated / self-hosted の
  3 mode 比較。kernel は同じ compiled manifest を mode 越しに apply する。
- [Control Plane](./control-plane.md) — kernel control 面 (manifest apply /
  provider DAG / resource resolution) の実装。account plane (Takosumi Accounts)
  とは別レイヤー。
