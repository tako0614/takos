# Deploy System

::: tip Internal implementation このページは deploy system の internal
実装を説明する。public contract は [manifest spec](/reference/manifest-spec) と
[API reference](/reference/api) を参照。 :::

Takos の deploy system は authoring/API surface では **primitive-first**
です。component / route / publication / resource / consume edge は
compatibility projection として個別 record に見えますが、`takosumi` Core
の正本は 3 つの record に集約されています:

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
> [Current Implementation Note](/takos-paas/current-state#deploy-shell) を参照

実装上の分かれ方:

- **Primitive records** — service、deployment、route、custom domain、resource、
  publication、consume edge などの authoring/API projection record
- **Group** — primitive を任意に束ねる state scope。inventory、source metadata、
  current deployment pointer、reconcile status など group 機能の state を持つ
- **Manifest / source** — primitive desired declaration の入力。local file、
  repository ref、catalog package から解決される
- **Deployment record** — group に所属する deployable primitive の applied state
  と source metadata を保存する history。repository source 由来は bundled
  snapshot ではなく source metadata / resolved commit として保存する

Group は runtime backend でも resource provider でもありません。component /
container / resource はそれぞれ compatibility projection として存在し、 group は
`group_id` と deployment metadata でそれらを同じ inventory / lifecycle scope に
載せます。 group なし primitive も、group 所属 primitive も、個別 API と runtime
adapter 上は同じ primitive projection です。

## Manifest format

`.takos/app.yml` は flat YAML の primitive desired declaration です。 既定の
deploy manifest path で、`.takos/app.yaml` も受け付けます。 ファイル名には
`app` が残るが、意味上は AppSpec / EnvSpec / PolicySpec 入力をまとめた
deploy manifest です。

トップレベルは Core 語彙のみ:

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
              workflow: .takos/workflows/deploy.yml
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

envelope (`apiVersion` / `kind` / `metadata` / `spec`) は無い。 全 field が
トップレベル。 `worker` / `service` / `attached container` / `compute` /
`triggers` / `consume` といった旧 authoring 語彙は manifest 表面には存在せず、
全ての具体性は `ref: <descriptor>` と descriptor schema に従う `config:` に
置かれます。

normative な field 仕様は [manifest spec](/reference/manifest-spec) を参照。

## Primitive model

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
  - from:
      publication: takos.oauth-client
      request:
        clientName: My App
        redirectUris: [/api/auth/callback]
        scopes: [openid, profile]
    to:
      component: web
      env:
        OAUTH_CLIENT_ID: clientId
        OAUTH_CLIENT_SECRET: clientSecret
```

publication は space-level catalog entry です。 group 所属 publication は
group inventory から作られた projection ですが、 catalog lookup と consume
binding は group なし publication と同じ model で扱います。

## CLI / API

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

個別 primitive 操作:

- resource: `takos resource` / `takos res` または `/api/resources/*`
- component / route / custom domain: `/api/services/*`
- publication: `/api/publications/*`

既存 service / resource を後から group inventory に入れたい場合は
`PATCH /api/services/:id/group` / `PATCH /api/resources/:id/group` を呼ぶ。

## Group features

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

## Deploy pipeline

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

## Rollback

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

## Install / version / source tracking

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

## まとめ

```text
Takos deploy system (primitive-first):

  Primitive records
    - services + deployments (component / contract instance)
    - resources (sql / object-store / kv / queue / vector / secret / ...)
    - routes / custom domains
    - publications / bindings

  Optional group scope
    - groups row
    - inventory / source metadata / GroupHead pointer / reconcile status
    - features: deploy (resolve + apply) / deployment history / rollback / uninstall / updates

  CLI / API surface
    - deploy:    takos deploy / install
    - group:     takos group / rollback / uninstall
    - resource:  takos resource / takos res (+ /api/resources/*)
    - component: /api/services/*
    - grant:     /api/publications/*
```

group に所属している primitive は group 機能を使える。 所属していない
primitive も同じ primitive model で扱われる。
