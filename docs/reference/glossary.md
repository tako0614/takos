# 用語集

この用語集は、Takos Docs
を読むうえで最低限ぶれやすい語だけを揃えるためのものです。
仕様上の意味を優先し、実装の細部や列挙の網羅はここでは扱いません。

## Docs ラベル

### Current contract

利用者が依存してよい documented public surface。manifest, CLI, API, example
がこの語で示す対象を優先して読む。

### Implementation note

current contract と実装 wiring の差分を示す注記。
「今日たまたま動くもの」の案内ではなく、差分の説明として読む。

### Public surface

利用者・運用者・runtime 側が直接触る面。`.takosumi/app.yml` /
`.takosumi/manifest.yml` authoring convention、`takosumi-git` CLI、kernel
`POST /v1/deployments`、Takos product API などを含む。kernel-bound manifest は
compile 済み Shape manifest であり、旧 `.takos/app.yml` / `.takos/app.yaml` は
current surface ではない。

### Internal model

control plane / backend / runtime の内部構造を説明する面。重要でも public
contract とは限らない。

## 中核概念

### Installable App Model

Git URL から Takosumi Account に install する app の正本モデル (= Git-installed
Materializable App Model)。Takos 自身も "installable app" として扱われ、所有権は
Takosumi Account の AppInstallation 台帳に置かれる。 OAuth provider は Takosumi
Accounts に集約し、takosumi kernel は compute-only を保つ。 (see new.md §0,
[architecture/installable-app-model](/architecture/installable-app-model))

### takosumi kernel

generic な compute kernel。manifest deploy engine に専念し、
`POST /v1/deployments` で compile 済み Shape manifest を受け取る。shape /
provider / resource DAG / outputs resolver / idempotent apply を提供する。
OAuth、OIDC issuer、user account、billing、app marketplace、workflow、cron、
consent screen は **持たない**。 (see new.md §2.1)

### takosumi-cloud

managed PaaS product。dashboard、project、app installation ledger、Git URL
install UI、usage metering、domain management、auth connections を束ねる account
/ billing / install plane。 (see new.md §2.2)

### Takosumi Accounts

takosumi-cloud の account plane。upstream IdP (Google / GitHub / Passkey /
Enterprise OIDC) を broker し、stable Takosumi subject を発行する。billing
account / team / org / app installation owner も保持する。managed default の
hostname はあってよいが、consumer は `takosumi.account.auth@v1` service
identifier と anchor resolver 経由で参照し、特定 hostname を contract にしない。
(see new.md §2.3,
[architecture/takosumi-accounts](/architecture/takosumi-accounts))

### takosumi-git

installer / manifest compiler / GitOps deploy bridge。Git URL fetch、
`.takosumi/app.yml` parse、`.takosumi/workflows/*.yml` run、artifact resolve、
binding metadata / service import compile、kernel への deploy を担う上位 sibling
product。 (see new.md §2.4, §12)

### Takosumi Account

契約・billing・identity の owner。Takos などの app は AppInstallation として
Takosumi Account 配下の Space に install される。 (see new.md §0)

### Space

Takosumi Account 配下の install scope。`personal` / `team` / `org` の kind
を持ち、AppInstallation の親 (Takosumi Account → Space → AppInstallation
の階層)。 (see new.md §21)

### OIDC consumer

Takos の新しい立場。OAuth provider ではなく、`takosumi.account.auth@v1`
で解決される Takosumi Accounts の OIDC issuer を consume するだけの app。
self-host で Keycloak / Authentik / Auth0 等を使う場合も Takosumi Accounts の
upstream IdP として broker する。 (see
[apps/oidc-consumer](/apps/oidc-consumer))

### Deploy Dashboard

Installed Takos / Takosumi Accounts 側の product UI。kernel は dashboard SPA を
持たず、compiled manifest apply と provider reconciliation の API に専念する。

### Installed Group

space に deploy された group。Store / UI では app と表示する場合があるが、
deploy model では ManifestResource / Group と呼び分ける。

### Repo

source と workflow artifact の起点。deploy の source provenance を決める単位。

### Component

legacy AppSpec の deployable unit。current kernel-bound manifest では
`components.<name>` を使わず、`resources[]` の ManifestResource (`shape` /
`name` / `provider` / `spec`) で worker / web service / database などを
表現する。

### Resource

Shape manifest の apply 単位。`shape` / `name` / `provider` / `spec` を持ち、
`worker@v1` / `web-service@v1` / `database-postgres@v1` / `object-store@v1`
などで workload と backing capability を表現する。group 所属の有無で provider
apply semantics は変わらない。

### Binding

文脈で意味が分かれる語。Installable App Model では AppInstallation に紐づく
AppBinding (`identity.oidc@v1` / `database.postgres@v1` 等) を指す。kernel-bound
Shape manifest では top-level `bindings[]` は current surface ではなく、resource
spec の `env` / provider config、`${ref:...}` / `${secret-ref:...}`、
`${imports...}` で materialized wiring を表現する。

## Core meta-objects (PaaS Core normative)

これらは `takosumi/core/01-core-contract-v1.0.md` で normative に定義された PaaS
Core meta-objects。Takos Deploy では Core record は **Deployment /
ProviderObservation / GroupHead** の 3 つに圧縮される。`takosumi` Core を
canonical とする全 docs の参照点。

### Component (Core)

legacy Core v1.0 の名前付き contract instance bundle。current kernel-bound
surface では `components.<name>` ではなく Shape `resources[]` を使う。古い Core
contract を読む場合は compatibility vocabulary として扱う。

### Deployment

Core 中核 record。input manifest、resource DAG、provider operation、conditions /
WAL を 1 lifecycle として扱う。`status` は `preview` / `resolved` / `applying` /
`applied` / `failed` / `rolled-back` を遷移する。applied 後の desired state は
immutable で、変更は新 Deployment を作る。

### ProviderObservation

provider 側 observed state の append-only stream。`deployment_id` /
`provider_id` / `object_address` / `observed_state` / `drift_status` /
`observed_digest` / `observed_at` を持つ。observed state は canonical
でなく、`Deployment.desired` を mutate しない。drift 検知や repair plan の
trigger になるが、それ自体が新 Deployment を作るわけではない。

### GroupHead

group ごとの strongly consistent pointer。`current_deployment_id` と
`previous_deployment_id` を持ち、rollback は `current` <-> `previous` の atomic
swap として表現される。GroupHead 進行は Deployment の `ActivationCommitted`
condition と紐づき、新しい `current_deployment_id` の Deployment が group の
canonical 表現になる。

### ResourceInstance

Deployment / ProviderObservation / GroupHead 以外で Core が独立 record として
保持する 2 つの record の 1 つ（もう 1 つは MigrationLedger）。durable state を
複数 Deployment にまたがって保持し、Deployment 間で再利用される。 `status` は
`preparing` / `ready` / `retired` / `failed`。

### MigrationLedger

resource migration の forward-only 履歴 record。rollback では巻き戻されない
（`Deployment` の rollback は pointer move であって durable resource 状態の
復元ではない）。

## Deploy

### `.takosumi/app.yml`

installer-bound manifest。`apiVersion: app.takosumi.dev/v1` /
`kind: InstallableApp` を持ち、metadata / source (git URL + ref) / entry /
runtime modes / bindings / install / permissions / upgrade を宣言する。
takosumi-git が install UI / binding / permission preview に使い、kernel には
渡さない。 (see new.md §5.1, [reference/app-yml-spec](/reference/app-yml-spec))

### `.takosumi/manifest.yml`

kernel-bound compute manifest。`apiVersion: "1.0"` / `kind: Manifest` と
`resources[]` (shape / name / provider / spec) を宣言する。`workflowRef` と
`${bindings.*}` / `${secrets.*}` / `${artifacts.*}` などの installer-only
placeholder は current takosumi-git が未解決なら compile error にし、 kernel
に渡る最終 manifest には残さない。kernel は `${ref:...}` / `${secret-ref:...}` /
`${imports...}` を resource DAG / service import として 扱える。 (see new.md §6,
[reference/manifest-spec](/reference/manifest-spec))

### Primitive records

legacy docs の呼称。current deploy model では ManifestResource / Deployment /
GroupHead / ResourceInstance を使う。公開 entrypoint は
`worker@v1.spec.routes`、 `web-service@v1.spec.domains`、`custom-domain@v1`
などの Shape resource から導出 される。

### Group

`groups` row として保存される optional compatibility state scope。 group 名、
source metadata、 current deployment pointer、 reconcile status、 inventory
を持つ。 group に所属する ManifestResource projection は inventory、 deployment
history、 rollback、 uninstall などの group 機能を使える。

### App / InstallableApp

Store / UI 上の product label であり、`.takosumi/app.yml` の
`kind:
InstallableApp` で宣言される Git URL から install できる app の
identity。 deploy model を説明するときは ManifestResource / Group / Deployment
を使い、 product label として表示するときは "App" と呼ぶ。詳細は下の
InstallableApp entry を参照。

### InstallableApp

`.takosumi/app.yml` の `kind` 値。Git URL から install できる app の identity
（id / name / publisher / source / entry / bindings / permissions / upgrade
policy）を宣言する単位。Takos 自身も `id: takos.chat` の InstallableApp
として扱われる。 (see new.md §5.1)

### Publication

legacy AppSpec / internal Core vocabulary。current kernel-bound manifest では
top-level `publications[]` を使わない。外部 entrypoint は Shape resource の
route/domain fields から導出し、cross-instance service export は `services[]` で
表現する。Takos API access は Takos product API / AppGrant の責務であり、kernel
manifest の publication catalog ではない。

### Consume

(legacy 用語) Component-level の依存 edge。current Shape manifest では resource
spec の `env` / provider config、`${ref:...}` / `${secret-ref:...}`、
`${imports...}` で wiring を表現する。

### Group Deployment Record

source provenance、manifest、artifact、実行 context を保存する group-scoped
deployment history record。HTTP API path family は
`/api/spaces/:spaceId/group-deployment-snapshots`。

### Rollout

deployment record を段階的に公開する制御。pause / resume / abort / promote
の操作を持つ。

### Rollback

前回成功 deployment record へ戻す操作。データや schema
の自動巻き戻しまで意味しない。

### Workflow Artifact

`.takosumi/workflows/` 配下の workflow が出力する build 成果物。deployment
record が参照する artifact provenance。

## Install lifecycle (Installable App Model)

### AppInstallation

所有権の primitive 台帳。`accountId` (Takosumi Account) / `spaceId` / `appId` /
source (git URL + ref + commit) / `appManifestDigest` / `compiledManifestDigest`
/ `serviceImports` / `mode` (shared-cell / dedicated / self-hosted) /
`runtimeBindingId` / `status` を持つ。Takos の installation owner を表現する
record。 (see new.md §7,
[architecture/app-installation](/architecture/app-installation),
[reference/install-api](/reference/install-api))

### AppInstallation.serviceImports

AppInstallation に保存される external service dependency の approval metadata。
`.takosumi/app.yml` top-level `serviceImports[]` と compiled manifest
`imports[]` を接続する。AppBinding kind ではない。 (see
[architecture/app-installation](/architecture/app-installation),
[reference/app-yml-spec](/reference/app-yml-spec))

### AppBinding

AppInstallation に紐づく binding 1 record。`identity.oidc@v1` /
`database.postgres@v1` / `object-store.s3-compatible@v1` / `domain.http@v1` /
`deploy-intent.gitops@v1` / `install-launch-token@v1` などの kind を持ち、
`configRef` / `secretRefs` で実値を参照する。 (see new.md §7,
[reference/binding-catalog](/reference/binding-catalog))

### AppGrant

AppInstallation に対する capability grant の 1 record。`capability` (例:
`app.profile.write` / `deploy.intent.write` / `logs.read.own` / `files:read` /
`agents:execute`) と `scope` を持ち、ユーザーが任意の タイミングで `revoke`
可能。capability は `.takosumi/app.yml` の `permissions.requested` と同じ v1
closed catalog に限定される。 (see
[reference/app-yml-spec](/reference/app-yml-spec#_3-7-permissions),
[architecture/app-installation](/architecture/app-installation))

### RuntimeBinding

AppInstallation を shared-cell / dedicated runtime に bind する record。 runtime
mode の切り替えは RuntimeBinding の差し替えとして表現される。 (see new.md §7)

### InstallationEvent

AppInstallation のライフサイクル audit event。install / upgrade / rollback /
materialize / export / grant revoke 等の出来事を append-only に記録する。 (see
new.md §7)

### shared-cell

runtime mode の 1 つ。Takos 公式の prebuilt / warm 済み shared runtime に
AppInstallation を bind し、build 待ちなしで instant に chat を開ける UX を
提供する。data namespace / OIDC client / billing / grants は installation
ごとに分かれるが、runtime process / image / common frontend cell は共有される。
(see new.md §10.1, [architecture/runtime-modes](/architecture/runtime-modes))

### dedicated

runtime mode の 1 つ。同じ source commit / app manifest digest / data namespace
/ OIDC binding / domain を保ったまま、shared-cell から専用 runtime
に物理化された状態。`takosumi-git materialize` で遷移する。 (see new.md §10.2,
[architecture/runtime-modes](/architecture/runtime-modes))

### self-hosted

runtime mode の 1 つ。`takosumi-git export` で installation bundle を取り出し、
別の takosumi (Keycloak / MinIO / 自前 Postgres など任意 binding) に import
した完全退出状態。 (see new.md §10.3,
[architecture/runtime-modes](/architecture/runtime-modes),
[platform/upgrade-export](/platform/upgrade-export))

### launch token JWS

install 直後の one-time bootstrap token。Takosumi Accounts が発行し、Takos の
`/_takosumi/launch` で検証して owner session を作る。有効期限は 5 分以下、
one-time、audience は appId と installationId に pin される短命 JWS。 (see
new.md §9, [apps/launch-token](/apps/launch-token))

### install preview

install 実行前に必ず表示される permission / cost preview。source (git URL +
commit + publisher verification)、requested bindings、requested grants、
estimated cost、runtime mode、auth issuer、data exportability を提示し、
ユーザーの approve を必須とする。 (see new.md §13,
[reference/install-api](/reference/install-api))

### GitOps deploy binding

`deploy-intent.gitops@v1`。Takos が takosumi kernel API を直接叩かず、
deployment intent を Git repo に commit / push し、takosumi-git が watch / build
/ kernel apply を担う binding。Takos の runtime 依存を Git remote + token
のみに抑える。 (see new.md §14)

### pairwise OIDC subject

Takosumi Accounts が app ごとに発行する OIDC subject。
`sub = pairwise(appId, installationId, takosumiUserId)` で計算され、app 間の
user tracking を防ぎ、installation 移動 / revoke / self-host export 時の
boundary を明確にする。 (see new.md §8.2)

### Use Takos

3 install paths の 1 つ。一般ユーザー向けの instant managed install。 Takosumi
Account 作成後、shared-cell AppInstallation が即座に作られ、 launch token 経由で
chat が開く。 (see new.md §18, §19, [apps/install-paths](/apps/install-paths))

### Install from Git

3 install paths の 1 つ。開発者 / 透明性重視ユーザー向け。Git URL + ref を
指定し、install preview を確認したうえで build / deploy する経路。
`takosumi.cloud/install?git=...&ref=...` の URL 形を使う。 (see new.md §18, §19,
[apps/install-paths](/apps/install-paths))

### Self-host

3 install paths の 1 つ。退出 / 企業 / 主権重視ユーザー向け。`takosumi
export`
で取り出した bundle、または直接 Git clone から、自前の takosumi インスタンスに
install する経路。OIDC issuer は自由に差し替えられる。 (see new.md §18, §19,
[apps/install-paths](/apps/install-paths),
[platform/upgrade-export](/platform/upgrade-export))

## AI 実行

### Thread

継続する対話や作業コンテキスト。

### Run

thread 上の 1 回の実行。stream surface を持つ。

### Artifact

run の結果物。コード、設定、文書、レポートなどを含む。2 つの保存形式を持つ:

- **inline**: `content` field に文字列として保存 (テキスト系の小サイズ artifact
  向け)
- **file-backed**: `file_id` field に space storage の file ID を参照 (binary
  や大サイズ向け)

両 field は排他ではないが、通常は片方のみ使用される。

## 認証

### PAT (Personal Access Token)

CLI / automation 用の bearer token。

### Managed Token

deploy された group が Takos API を呼ぶための Takos-managed token。権限は Takos
product API / AppGrant 側の scope 宣言で制御する。

### Takos profile (app-local)

Installable App Model における Takos 内のユーザーレコード。 `installationId` /
`externalIssuer` / `externalSubject` (pairwise) / display name / email / memory
settings / preferences を持つ。契約や billing は持たない。 `externalIssuer` は
Takosumi Accounts の service import / OIDC binding から materialize され、特定
hostname を docs contract にしない。 (see new.md §11)

### Takosumi Cloud billing

請求主体。Takosumi Account に対する subscription / compute usage / storage usage
/ model usage を line item として記録し、Takosumi Cloud が invoice を
発行する。Takos 自身は billing owner にならない。 (see new.md §20)

### Scope

OAuth / managed token が要求・付与する権限の粒度。

## Publication descriptors {#publication-types}

legacy AppSpec / descriptor-set vocabulary。current kernel-bound Shape manifest
では top-level `publications[]` を使わず、HTTP entrypoint は resource shape
(`worker@v1.spec.routes` / `web-service@v1.spec.domains` / `custom-domain@v1`)
で表現する。以下は古い descriptor docs を読むための互換用語です。

| canonical ref                  | 用途                            |
| ------------------------------ | ------------------------------- |
| `publication.http-endpoint@v1` | 汎用 HTTP endpoint              |
| `publication.app-launcher@v1`  | UI launcher / app catalog entry |
| `publication.file-handler@v1`  | MIME / 拡張子 file handler      |
| `publication.mcp-server@v1`    | MCP server                      |
| `publication.topic@v1`         | event topic                     |

完全な一覧と output / spec / metadata schema は
[Official Descriptor Set v1 § Minimum publication descriptors](/takosumi/descriptors/official-descriptor-set-v1#minimum-publication-descriptors)
を参照。

## Binding env injection {#consume-env-injection}

legacy AppSpec / internal Core vocabulary。current Shape manifest では top-level
`bindings[]` ではなく、resource spec の `env` / provider config に materialize
された値を置く。

```yaml
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        DATABASE_URL: ${ref:db.connectionString}
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
```

## 配布と連携

### Store

Takos product 側が提供する app-label / package の検索・配布 surface。 takosumi
kernel の機能ではない。

### Canonical URL

group 自身が所有する基準 URL。bookmark、share、reload、direct access はこの URL
を使う。

### Launch URL

deploy dashboard から deployed UI を開くための URL。

### MCP (Model Context Protocol)

repo や group がツール surface を公開するための主要 protocol。 manifest の
`publications` に `ref: publication.mcp-server@v1` として宣言する。 MCP server
catalog は deploy manifest の `publications` entry で管理する。

### File Handler

storage/file 系 UI から handler UI を開く contract。 manifest の `publications`
に `ref: publication.file-handler@v1` として宣言する。 FileHandler catalog は
deploy manifest の `publications` entry で管理する。

## 実行基盤

### Control Plane

API, deploy, routing, run lifecycle, resource 管理を担当する Takos の制御面。

### Tenant Runtime

deploy された artifact が実際に request を処理する実行面。 user workload (group
/ component) の execution plane で、 dispatch + worker から構成される。 kernel
内の compute substrate の一部であり、Takosumi Account (account plane) や
AppInstallation (account plane の所有権 primitive) とは異なる layer。
[architecture/tenant-runtime](/architecture/tenant-runtime) が canonical。

### dispatch

takosumi kernel 内部の routing role。受信 request の routing / canary 振り分け /
header injection / boundary enforcement を担当し、 tenant runtime と control
plane の境界に位置する。
[architecture/tenant-runtime](/architecture/tenant-runtime) /
[architecture/diagrams](/architecture/diagrams) で言及される。

### artifact descriptors

`artifact.workflow-bundle@v1` / `artifact.oci-image@v1` などの artifact 種別
列挙。 takosumi-git の workflow runner が生成し、 kernel が consume する。
完全な定義は
[Official Descriptor Set v1](/takosumi/descriptors/official-descriptor-set-v1)
を参照。

### Backend

deploy backend の種類。Cloudflare と local などの差分は operator-only
configuration / architecture で扱う。public deploy manifest には backend
名を書かない。

## Workers backend implementation note

Cloudflare Workers / Cloudflare Containers / wrangler.toml 系の固有用語は
`takosumi` の reference materialization detail であり、Core 用語ではない。 各
architecture / hosting 章では Workers backend collapsible 節に集約する。

| Cloudflare-shaped 名                                      | 役割 (Core 用語との対応)                                                              |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `{ADMIN_DOMAIN}` / `{KERNEL_DOMAIN}`                      | kernel host (canonical: `{KERNEL_DOMAIN}`)                                            |
| `takos-dispatch` worker                                   | dispatch / RouteProjection の Workers materialization                                 |
| `takos-worker` (background)                               | ApplyRun worker process role の Workers materialization                               |
| `RoutingDO` (L1/L2/L3 cache)                              | RouteProjection の Workers backend cache 層                                           |
| Container DO (`takos-runtime-agent` / `takos-log-worker`) | runtime host process role の Workers materialization                                  |
| wrangler.toml                                             | Workers backend 用 deploy 設定 (current path: `takos/app/apps/control/wrangler.toml`) |

architecture/control-plane.md 等の collapsible 節以外でこれらの固有名を本文で
使わないこと。

統一呼称: Cloudflare Workers backend を docs では一律 **"tracked reference
Workers backend"** と呼ぶ（'Cloudflare backend' / 'Workers backend' / 'primary
production backend' / 'tracked reference template' を使い分けない）。

## Cross-instance service binding vocabulary

下記は Cross-instance service binding primitive の用語です。consumer-side の
manifest validation / anchor resolution / signature verify / descriptor pinning
は mainline 実装済みで、provider publish / cache refresh / durable audit は 継続
work です。設計の正本は
[architecture/cross-instance-service-binding](/architecture/cross-instance-service-binding)、
formal spec は
[reference/service-identifier-spec](/reference/service-identifier-spec) を参照。

### Service identifier

外部 takosumi instance の service を location-independent に参照する識別子。
**forward 3-level dotted format** (`<ecosystem>.<area>.<function>@<version>`、
例 `takosumi.account.auth@v1`) を取る。 hostname としては機能しない (DNS
解決可能な FQDN ではない)。 consumer manifest の `imports[].service` で
参照され、 anchor 経由 `ServiceDescriptor` に resolve される。

### Anchor

service identifier から `ServiceDescriptor` への resolution を担う web service。
consumer manifest の `serviceResolvers[].url` で 1 個以上 pin され、 `publicKey`
で signed-descriptor を verify する。 anchor 自身も
`takosumi.platform.anchor@v1` で service identifier として expose 可能 (ただし
bootstrap は consumer manifest の anchor URL pin)。 kernel は anchor を持たず、
operator が manifest 経由で inject する。

### ServiceDescriptor

provider が anchor に publishする service metadata。 `id` / `version` /
`endpoints[]` (operator deploy 時に resolved) / `metadata` / `signature` /
`publishedAt` / `expiresAt` / `providerInstance` を持つ。 kernel は anchor から
fetch して descriptor digest / provider instance / expiry を resource metadata
に pin する。

### CrossInstanceShare

consumer 側 deployment で resolved した cross-instance service binding の audit
record。 `serviceId` / `toDeploymentId` / `resolvedDescriptor` / `resolvedAt` /
`refreshPolicy` / `revokedAt` / `auditTrail` (append-only hash chain) を持つ。
同 instance 内 `SpaceExportShare` の sibling primitive。

### EndpointRoleResolved

`ServiceDescriptor.endpoints[]` の各要素。 `role` (例 `oidc-issuer` /
`install-launch` / `stripe-webhook`) / `url` (operator-injected) / `path`
を持つ。 consumer manifest の resource spec で
`${imports.<alias>.endpoints.<role>.url}` として参照される。

### Cross-instance service binding

manifest の `imports[]` + `serviceResolvers[]` で構成される consumer 側の
service identifier import mechanism。 endpoint URL を consumer manifest
に書かない設計。 詳細は
[architecture/cross-instance-service-binding](/architecture/cross-instance-service-binding)
を参照。
