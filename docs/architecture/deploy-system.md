# Deploy System

::: tip Internal implementation
このページは deploy system の internal 実装を説明する。public contract は
[manifest spec](/reference/manifest-spec) と [API reference](/reference/api)、
そして Installable App Model の入口は
[Installable App Model](./installable-app-model.md) を参照。
:::

Takos の deploy system は **Installable App Model** の登場で、
"CLI が直接 kernel を叩いて deploy する" 単一 path から、**3 種の deploy path**
を持つ多層構造に書き換わりました。本ページは、それぞれの path がどの entity
を経由し、どの record を更新するかを **正本** として整理し、その下にある
primitive / Core record 構造 (`takosumi` Core の Deployment /
ProviderObservation / GroupHead) と provider DAG を引き続き説明します。

## 0. 3 種の deploy path (canonical)

Installable App Model 配下の Takos には、deploy intent の origin が異なる
**3 種の path** が存在します。どの path も最終的には takosumi kernel の
`POST /v1/deployments` (= compute apply) に着地しますが、**Takos / 利用者
から見える surface は別物** です。

| # | path                          | trigger                                     | 主体                            | 用途                                 |
| - | ----------------------------- | ------------------------------------------- | ------------------------------- | ------------------------------------ |
| 1 | **Install path**              | `POST /v1/installations` (新規 install)     | takosumi-git installer pipeline | App を新規に install する            |
| 2 | **Upgrade path**              | `POST /v1/installations/:id/upgrade`        | 同 installer pipeline (再走)    | source ref / manifest を更新する     |
| 3 | **GitOps deploy binding**     | Takos が deploy intent repo に `git push`   | Takos → takosumi-git watcher    | Takos が自分の中から deploy する     |

::: warning kernel 直叩きは non-canonical
旧来の "CLI から直接 kernel に compiled manifest を投げる" 経路は、operator /
internal debug でのみ使用する non-canonical path として残します。**通常の
deploy はすべて上記 3 path のいずれかを通る** のが Installable App Model の
不変条件です。kernel に `.takosumi/app.yml` を直接渡してもいけません
(kernel は `app.yml` を解釈しない)。
:::

3 path に共通する不変条件は次のとおりです。

- kernel は `compiled manifest` (= placeholder ゼロの compute manifest) しか
  受け取らない
- `.takosumi/app.yml` (installer-bound) は **kernel に渡らない**。これは
  installer / preview / binding catalog のための surface
- `.takosumi/manifest.yml` (kernel-bound) は **compile 後** にのみ kernel が
  受け取る。`${bindings.*}` / `${secrets.*}` / `${refs.*}` placeholder を
  含んだ生 manifest を kernel に投げてはいけない (詳細は
  [.takosumi/app.yml spec](/reference/app-yml-spec) と
  [Installable App Model § 2 つの manifest](./installable-app-model.md))

## 1. Install path (新規 install)

新規に Takos (もしくは任意の InstallableApp) を Takosumi Account の Space に
入れる経路。`takosumi.cloud/install?git=...&ref=...` の "Install Takos" 流入や
`takosumi install <git-url>` CLI、`POST /v1/installations` API がここに集約
されます。

### 1.1 Install pipeline 13 step

new.md §12 の install pipeline を canonical step として固定し、
[Installer Pipeline](./installer-pipeline.md) と AppInstallation status 遷移
[(AppInstallation 台帳)](./app-installation.md) で詳細化しています。
本ページではフローのみ示します。

```txt
1. Git URL 受信                   (takosumi-git API)
2. repository fetch               (shallow clone)
3. ref → commit SHA pin           (sourceCommit を確定)
4. .takosumi/app.yml parse        (InstallableApp v1 metadata + bindings)
5. .takosumi/manifest.yml parse   (template manifest)
6. install preview 生成           (publisher / commit / bindings / grants / cost)
7. user approve                   (preview を確認しないと進まない)
8. workflow sandbox 実行          (build phase に runtime secrets を渡さない)
9. artifact resolve               (image digest / asset URI を解決)
10. bindings 注入                 (identity.oidc@v1, database.postgres@v1, ...)
11. manifest compile              (placeholder を実値に解決、digest を計算)
12. kernel deploy                 (POST /v1/deployments で apply)
13. AppInstallation ready         (status: ready, runtimeBindingId を確定)
```

step 11 で **compiled manifest digest** が確定し、AppInstallation 行の
`compiledManifestDigest` 列に保存されます。kernel はこの digest と一致する
compiled manifest だけを apply します。Step 12 以降は本ページ後半で説明する
従来の Deployment / ProviderObservation / GroupHead の世界に入ります。

### 1.2 何が AppInstallation に保存されるか

step 13 で AppInstallation 行は `installing → ready` に遷移し、次の値が
**immutable** に pin されます。

- `sourceGitUrl` / `sourceRef` / `sourceCommit`
- `appManifestDigest` (`.takosumi/app.yml` の digest)
- `compiledManifestDigest` (kernel に渡した compute manifest の digest)
- `mode` (shared-cell / dedicated / self-hosted)
- `runtimeBindingId` (どの cell / runtime に bind されたか)

これにより、後から「何を install したか」を AppInstallation 行と
InstallationEvent ledger だけで完全に再構築できます。詳細な field は
[AppInstallation 台帳](./app-installation.md) を参照。

## 2. Upgrade path (source ref を更新)

既存 installation の source ref / `.takosumi/app.yml` / `.takosumi/manifest.yml`
を更新する経路。**install path と同じ pipeline を再走** し、新しい
compiled manifest digest を作って kernel に apply する点で構造的に install
path と同一です。

```bash
takosumi upgrade inst_abc --ref v1.2.4
```

差分は以下:

- step 7 の `install preview` は **upgrade preview** として manifest diff /
  permission diff / migration plan を提示する
- AppInstallation 行は新しい `sourceCommit` / `appManifestDigest` /
  `compiledManifestDigest` で **更新される** (新規 row は作らない)
- 旧 compiled manifest digest は **rollback 用に保存** され、
  `takosumi rollback inst_abc --to v1.2.3` で前の digest に戻せる

upgrade / rollback の UI / 仕様は [Upgrade / Export](/platform/upgrade-export)
を参照。

## 3. GitOps deploy binding (Takos が deploy intent を出す)

Takos 自身が "何かを deploy したい" と判断したとき (例: ユーザーが Takos 内の
sub-app を作る、agent が新しい worker を立てる) には、**Takos は kernel API を
直接叩きません**。代わりに **GitOps deploy binding** (`deploy-intent.gitops@v1`)
を使い、deployment intent を Git repo に commit / push するだけにします。

### 3.1 流れ

```txt
Takos (Installed)
  │
  │ 1. deployment intent (manifest YAML) を生成
  │
  ▼
DEPLOY_INTENT_REMOTE (= installation 専用 Git repo)
  │
  │ 2. git push (DEPLOY_INTENT_TOKEN で auth)
  │
  ▼
takosumi-git watcher
  │
  │ 3. push を検知 → installer pipeline を再走 (workflow / compile)
  │
  ▼
takosumi kernel
  │
  │ 4. compiled manifest を apply
  │
  ▼
新 / 更新された Deployment record (group ごと)
```

### 3.2 Takos が知らなくていい env list

GitOps deploy binding を採用すると、Takos の runtime 依存は次の env のみに
なります (詳細は [Binding Catalog § deploy-intent.gitops@v1](/reference/binding-catalog) を参照)。

```env
DEPLOY_INTENT_DRIVER=gitops
DEPLOY_INTENT_REMOTE=https://git.takosumi.cloud/installations/inst_abc/deployments.git
DEPLOY_INTENT_BRANCH=main
DEPLOY_INTENT_TOKEN=...
```

逆に Takos が **知らないもの** (= runtime 依存に **入れない** もの):

- takosumi kernel の endpoint や auth token
- provider credential (Cloudflare API token / AWS keys / 等)
- Takosumi Cloud internal deployment token
- Takosumi Accounts internal API
- Takosumi Cloud billing API

つまり Takos は kernel client / Takosumi 専用 SDK ではなく、**「Git に intent
を書く app」** として完結します。Git が契約書、manifest が設計図、takosumi-git
が大工、kernel が工事現場、という分業が成立します。

### 3.3 budget guard

GitOps binding を経由する deploy intent も、Takosumi Accounts の budget guard
で高額操作を止められます。

```txt
Takos wants to create:
  GPU worker
Estimated cost:
  ¥1,200 / day

Approve?
```

普段の UX を壊さず、高額操作のみ user 確認を挟む設計です (new.md §22.7)。

## 4. compiled manifest と app.yml の役割分離

3 path に共通する **設計の核** は、`.takosumi/app.yml` と
`.takosumi/manifest.yml` を厳格に分離することです。

| ファイル                  | 受領者                  | 解釈タイミング              | 内容                                                    |
| ------------------------- | ----------------------- | --------------------------- | ------------------------------------------------------- |
| `.takosumi/app.yml`       | takosumi-git installer  | install / upgrade pipeline  | InstallableApp v1 metadata + bindings + permissions     |
| `.takosumi/manifest.yml`  | takosumi-git → kernel   | compile 時 (kernel 直前)    | compute resource declaration (placeholder 込み)         |
| compiled manifest         | takosumi kernel         | `POST /v1/deployments`      | placeholder ゼロの素朴な compute manifest               |

- `.takosumi/app.yml` は **kernel に渡してはいけない**。kernel は
  `identity.oidc@v1` のような binding type を **知らない**。
- `.takosumi/manifest.yml` は `${bindings.*}` / `${secrets.*}` /
  `${refs.*}` / `${artifacts.*}` / `${installation.*}` / `${params.*}` の
  placeholder を含み、これも **そのまま kernel に渡してはいけない**。
- kernel が apply するのは **compiled manifest** で、すべての placeholder が
  実値に解決済み (image digest / DB URL / OIDC issuer URL / ... が直値) です。

field 定義は [.takosumi/app.yml spec](/reference/app-yml-spec)、placeholder
文法と binding 種別は [Binding Catalog](/reference/binding-catalog)、Compiler
の動きは [Installer Pipeline](./installer-pipeline.md) を参照。

## 5. 共通基盤: Core record と primitive projection

3 path のいずれを通っても、kernel に apply された後の Takos deploy system は
**`takosumi` Core の 3 record + 2 durable record** に集約されます。authoring
surface (`components` / `routes` / `publications` / `bindings` / `resources`)
は依然 primitive-first ですが、internal canonical 表現は次のとおりです。

- **Deployment** — input (`manifest_snapshot`) → resolution
  (`descriptor_closure` / `resolved_graph`) → desired (`routes` / `bindings` /
  `resources` / `runtime_network_policy` / `activation_envelope`) →
  conditions の 4 layer を 1 record に内包する中核 record
- **ProviderObservation** — provider 側の observed state を separate stream
  として記録 (canonical な真値ではない)
- **GroupHead** — group ごとの `current_deployment_id` /
  `previous_deployment_id` pointer

`ResourceInstance` / `MigrationLedger` のみ Deployment 外の独立 record として
durable state を持ちます。group に所属しているかどうかで runtime や resource
provider の扱いは変わりません。

> 現行実装の split status は
> [Current Implementation Note](/takosumi/current-state#deploy-shell) を参照

実装上の分かれ方:

- **Primitive records** — service、deployment、route、custom domain、resource、
  publication、binding edge などの authoring/API projection record
- **Group** — primitive を任意に束ねる state scope。inventory、source metadata、
  current deployment pointer、reconcile status など group 機能の state を持つ
- **Manifest / source** — primitive desired declaration の入力。local file、
  repository ref、catalog package から解決される
- **Deployment record** — group に所属する deployable primitive の applied state
  と source metadata を保存する history。repository source 由来は bundled
  snapshot ではなく source metadata / resolved commit として保存する

Group は runtime backend でも resource provider でもありません。component /
container / resource はそれぞれ compatibility projection として存在し、group は
`group_id` と deployment metadata でそれらを同じ inventory / lifecycle scope に
載せます。 group なし primitive も、group 所属 primitive も、個別 API と runtime
adapter 上は同じ primitive projection です。

## 6. Manifest format (compute manifest, primitive-first)

`.takosumi/manifest.yml` (旧 `.takos/app.yml` / `.takos/app.yaml` は deprecated alias) は flat YAML の primitive desired declaration です。
ファイル名には `app` が残るが、意味上は AppSpec / EnvSpec / PolicySpec 入力を
まとめた compute manifest です。トップレベルは Core 語彙のみ:

```yaml
name: my-app

components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takosumi/workflows/deploy.yml
              job: bundle
              artifact: web
              entry: dist/worker.js
      ui:
        ref: interface.http@v1

routes:
  - id: ui
    expose: { component: web, contract: ui }
    via:
      ref: route.https@v1
      config: { path: / }

bindings:
  - from:
      publication: takos.api-key
      request: { scopes: [files:read] }
    to:
      component: web
      env:
        TAKOS_API_URL: endpoint
        TAKOS_TOKEN: apiKey

publications:
  - name: search
    ref: publication.mcp-server@v1
    outputs:
      url: { from: { route: ui } }
    spec:
      transport: streamable-http
```

envelope (`apiVersion` / `kind` / `metadata` / `spec`) は無い。全 field が
トップレベル。`worker` / `service` / `attached container` / `compute` /
`triggers` / `consume` といった旧 authoring 語彙は manifest 表面には存在せず、
全ての具体性は `ref: <descriptor>` と descriptor schema に従う `config:` に
置かれます。

normative な field 仕様は [manifest spec](/reference/manifest-spec)、Installable
App Model 上の二段構造は [Installable App Model § 2 つの manifest](./installable-app-model.md)
を参照。

## 7. Primitive model

### Component

`components.<name>` は AppSpec の component declaration。各 component は
名前付き **contract instance** を `contracts` map で宣言します
(Core § 5)。 contract instance は `ref: <descriptor>` で identity を持ち、
descriptor が runtime / artifact / interface 等のロールを定義します。

worker-style と service-style の区別は manifest にはありません。
`runtime.js-worker@v1` を ref に持つ component が JS bundle 駆動、
`runtime.oci-container@v1` を ref に持つ component が長寿命 container
駆動です。 旧 attached container は **別 component** として宣言し、
必要なら `depends` で順序関係を declaration します。

component / contract instance は内部では `services` と `deployments` に
保存されます。 group 所属の有無は record の runtime 形態を変えません。

### Resources

SQL / object-store / queue / secret などの stateful capability は
`resources.<name>` で `ref: resource.*@v1` を持つ claim として宣言します。
Backend / adapter の選択は `provider-selection` policy gate と operator-only
configuration で解決され、 manifest には provider 名は出ません。

resource access は `bindings[]` での **明示** edge です (Core invariant 4 /
7)。 `resources.<name>` 自体は env / runtime binding を inject しません。

### Routes

`routes[]` は `expose: { component, contract }` で exposure target を、
`via: { ref, config }` で listener / match / transport descriptor を
declaration します (Core § 10)。

```yaml
routes:
  - id: api
    expose: { component: web, contract: api }
    via:
      ref: route.https@v1
      config:
        path: /api
        methods: [GET, POST]
        timeoutMs: 30000
```

hostname は routing layer で管理:

- auto hostname: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug: `{slug}.{TENANT_BASE_DOMAIN}`
- custom domain: 任意 (DNS 検証 + SSL)

公開可能な interface ref は descriptor が `exposureEligible=true` で declare
した場合のみ。 同じ `path` で HTTP method が重なる route、 1 contract
instance を複数 path に分ける route は invalid。 publication output は
`from: { route: <id> }` で `routes[].id` を参照するため、`routes[].id` は
manifest 内で一意。

queue / schedule / event subscription は `route.queue@v1` /
`route.schedule@v1` / `route.event@v1` を `via.ref` に指定します。 これらの
`config.source` は manifest の `resources.<name>` を参照し、 producer 側
access は別途 `bindings[]` で declaration します。

### Publications / bindings

`publications[]` は primitive が space-level publication catalog に出す
typed outputs を declarative に宣言します (Core § 10)。 publication は
injection を含意せず、 consumer は `bindings[].from.publication` で明示的に
consume します。

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

`bindings[]` は consumer ↔ source の explicit edge で、 4 source kind
(`resource` / `publication` / `secret` / `provider-output`) を持ちます
(Core § 11)。 internal storage は `service_consumes` / runtime binding
record として保存されます。 manifest で管理する component では、 次回
apply 時に manifest の内容で binding 設定を置き換えます。

```yaml
bindings:
  - from: { resource: app-db }
    to: { component: web, env: DATABASE_URL }
    access: database-url
```

publication は space-level catalog entry です。 group 所属 publication は
group inventory から作られた projection ですが、 catalog lookup と consume
binding は group なし publication と同じ model で扱います。

::: info Installable App binding は別レイヤー
ここで述べる Core `bindings[]` (component ↔ publication / resource / secret
/ provider-output) と、Installable App Model の `.takosumi/app.yml` の
`bindings:` (`identity.oidc@v1` / `database.postgres@v1` 等) は **別レイヤー**
の概念です。後者は installer-bound で、compile 時に前者の `bindings[]` や
component env に展開されます。詳しくは
[Binding Catalog](/reference/binding-catalog) を参照。
:::

## 8. CLI / API

CLI は manifest / repository / catalog source から primitive declaration を
apply する task-oriented surface を提供する。 `takos deploy` /
`takos install` は group deployment history を更新するため、 group 名を
明示し、 その group inventory に参加する。

```bash
takos deploy --space SPACE_ID --group my-app                       # resolve + apply (Heroku-like sugar)
takos deploy --resolve-only --space SPACE_ID --group my-app        # resolved Deployment を作成 (apply 待ち)
takos deploy --preview --space SPACE_ID --group my-app             # 差分プレビュー (non-mutating、record なし)
takos apply <deployment-id> --space SPACE_ID                        # resolved Deployment を apply
takos diff <deployment-id> --space SPACE_ID                         # resolved expansion + diff
takos approve <deployment-id> --space SPACE_ID                      # optional approval を attach
takos install OWNER/REPO --space SPACE_ID --group my-app            # catalog から source を解決して apply
takos rollback GROUP_NAME --space SPACE_ID                          # GroupHead を previous_deployment_id に切替
takos uninstall GROUP_NAME --space SPACE_ID
takos group list --space SPACE_ID                                   # group inventory
takos group show NAME --space SPACE_ID
```

::: warning operator / internal context
上記の `takos deploy` / `takos install` 系 CLI は **operator / internal**
の context で使うものです。Installable App Model 配下の通常の Takos
利用者は、以下の path を使ってください。

- 一般ユーザー: `Use Takos` ボタン (Install path)
- 開発者: `takosumi install <git-url>` または
  `takosumi.cloud/install?git=...&ref=...` (Install path)
- Takos 自体が deploy する場合: GitOps deploy binding (Takos が intent
  を Git に commit、kernel API を直接叩かない)

詳細は [Install Paths](/apps/install-paths) と
[deploy CLI ガイド](/deploy/deploy) を参照。
:::

個別 primitive 操作:

- resource: `takos resource` / `takos res` または `/api/resources/*`
- component / route / custom domain: `/api/services/*`
- publication: `/api/publications/*`

既存 service / resource を後から group inventory に入れたい場合は
`PATCH /api/services/:id/group` / `PATCH /api/resources/:id/group` を呼ぶ。

## 9. Group features

Group と primitive projection record の責務は次のように分ける。

- component / contract instance は `services` と `deployments` に保存される
- route は routing / custom-domain record に保存される
- publication は `publications`、binding は `service_consumes` / runtime
  binding record に保存される
- resource は `resources` に保存される
- group は `groups` row として inventory / source metadata / current
  deployment pointer / reconcile status を持つ compatibility projection
- deployment history / rollback / uninstall は group inventory に対する
  機能であり、primitive runtime の特別処理ではない

```text
group "my-app":
  groups row:
    inventory / source metadata / GroupHead pointer / reconcile status
  group features:
    deploy (resolve + apply) / deployment history / rollback / uninstall
  inventory:
    component: web
    route: /
    publication: files
    resource: shared-cache

group なし primitive:
  component: cron-job
  resource: shared-db
  route/custom-domain: redirect
```

## 10. Deploy pipeline (kernel apply の内部)

`takos deploy` / `takos deploy --resolve-only` が public deploy entrypoint。
group apply の HTTP API path も同じ内部 pipeline を通る。 pipeline は
Deployment lifecycle (`preview` → `resolved` → `applying` → `applied` /
`failed` / `rolled-back`) を 1 record で表現する。

1. **Authoring expansion**
   - deploy manifest を parse して primitive desired declaration に compile
   - `components.<>.expand` (composite) や `bindings[].from.secret` などの
     authoring shorthand は canonical component / contract instance form に
     展開され、 expansion descriptor digest (`authoring.*@v1`) も
     descriptor_closure に含める
   - group が指定されている場合は group membership を付与する
2. **Resolution** (status → `resolved`)
   - descriptor を resolve して digest pin、
     `Deployment.resolution.descriptor_closure` と
     `Deployment.resolution.resolved_graph` (component / projection) を確定
   - `Deployment.desired.routes` / `.bindings` / `.resources` /
     `.runtime_network_policy` / `.activation_envelope` を生成
   - resolution-gate の policy decision を `Deployment.policy_decisions[]`
     に記録
3. **Diff** (read-set validation)
   - 現在 GroupHead が指す Deployment.desired と新 Deployment.desired を
     比較
   - resource creation は resource API 側の責務として扱う
4. **Workload apply** (status → `applying`)
   - component / contract instance を topological order で apply、
     per-component `depends` で順序を制御
   - 各 provider operation は `Deployment.conditions[]`
     (scope.kind="operation" / "phase") に append される
5. **Managed-state sync**
   - publication catalog を同期
   - `bindings[]` を validate し、 各 component の env / runtime binding
     に inject
6. **Routing reconcile**
   - workload apply と managed-state sync が成功した場合だけ route
     projection を reconcile (RoutingRecord として materialize)
7. **Activation commit** (status → `applied`)
   - `Deployment.desired.activation_envelope` を commit、 GroupHead の
     `current_deployment_id` を新 Deployment に進め、
     `previous_deployment_id` に旧 current を保持
   - group がある場合は group-scoped declaration / observed state /
     deployment pointer を更新する

## 11. Rollback

rollback は GroupHead の `current_deployment_id` を `previous_deployment_id`
(または明示指定された retained Deployment id) に向けて切り替える pointer
move です。 新 Deployment record は作成されず、 旧 current Deployment は
`rolled-back` status に遷移します。

- code + config + bindings が戻る (retained
  `Deployment.input.manifest_snapshot` と
  `Deployment.resolution.descriptor_closure` を再利用)
- DB data は戻らない (forward-only migration、 `MigrationLedger` は逆方向
  に進まない)
- resource の data / schema は自動巻き戻ししない
- group なし primitive の個別 rollback は、 その primitive API の contract
  に従う

Installable App Model 配下の **AppInstallation rollback** (`takosumi rollback
inst_abc --to v1.2.3`) は、これとは別レイヤーで、過去の compiled manifest
digest を再 apply することで実現されます (詳細は
[Upgrade / Export](/platform/upgrade-export))。

## 12. Install / version / source tracking

`takos install` は catalog (Store) で発見した repository を
`takos deploy URL --ref ...` へ解決する薄い wrapper です。 Store 自体は
発見と source 解決だけを担当します。

repo deploy / install の version は catalog が解決する Git ref / tag が
基準です。 manifest の `version` field は display 用。

```yaml
name: my-app
version: "1.2.0" # display 用。Git tag と一致させる慣習
```

group がある場合、 source 情報を group metadata と deployment record に
保存します。

- `local`: takos deploy で手元から deploy
- `repo:owner/repo@v1.2.0`:
  `takos install owner/repo --version v1.2.0 --space SPACE_ID --group NAME`
  で catalog が解決した repo/ref から deploy

Installable App Model における source pin は AppInstallation 行の
`sourceCommit` / `appManifestDigest` / `compiledManifestDigest` の 3 列で
表現されます (詳細は [AppInstallation 台帳](./app-installation.md))。

## まとめ

```text
Takos deploy system (Installable App Model 整合):

  3 deploy paths
    1. Install path     (POST /v1/installations    → installer pipeline → kernel apply)
    2. Upgrade path     (POST /v1/installations/:id/upgrade → 同 pipeline 再走)
    3. GitOps binding   (Takos → git push          → takosumi-git watcher → kernel apply)

  Compiled manifest (kernel に渡る最終形)
    - placeholder ゼロ
    - ${bindings.*} / ${secrets.*} / ${refs.*} / ${artifacts.*} は解決済み
    - kernel は app.yml を解釈しない

  Core records (kernel 内部)
    - Deployment (input / resolution / desired / conditions)
    - ProviderObservation (observed state stream)
    - GroupHead (current / previous deployment pointer)
    - ResourceInstance / MigrationLedger (durable state)

  Primitive projection (authoring surface)
    - services + deployments (component / contract instance)
    - resources (sql / object-store / kv / queue / vector / secret / ...)
    - routes / custom domains
    - publications / bindings

  Optional group scope
    - groups row
    - features: deploy / history / rollback / uninstall
```

## 次に読むページ

- [Installable App Model](./installable-app-model.md) — 全体像と 5 entity の
  責務分離
- [Installer Pipeline](./installer-pipeline.md) — 13 step の install pipeline 詳細
- [AppInstallation 台帳](./app-installation.md) — source pin と status 遷移
- [.takosumi/app.yml spec](/reference/app-yml-spec) — installer-bound manifest
- [Binding Catalog](/reference/binding-catalog) — `service.import@v1` を含む
  7 種の binding type
- [Install API](/reference/install-api) — `POST /v1/installations` 等
- [Upgrade / Export](/platform/upgrade-export) — upgrade / rollback / export
- [deploy CLI ガイド](/deploy/deploy) — operator / internal context での deploy
