# Deploy System

::: tip Internal implementation このページは deploy system の internal
実装を説明する。public contract は [manifest spec](/reference/manifest-spec) と
[API reference](/reference/api) を参照。
:::

Takos の deploy system は **primitive-first** です。worker / service / route /
publication / resource / consume edge は個別 record として保存され、group
に所属しているかどうかで runtime や resource provider の扱いは変わりません。

実装上の分かれ方:

- **Primitive records** — service、deployment、route、custom domain、resource、
  publication、consume edge などの実体 record
- **Group** — primitive を任意に束ねる state scope。inventory、source metadata、
  current snapshot pointer、reconcile status など group 機能の state を持つ
- **Manifest / source** — primitive desired declaration の入力。local file、
  repository ref、catalog package から解決される
- **Deployment snapshot** — group に所属する deployable primitive の applied
  state を保存する immutable history

Group は runtime backend でも resource provider でもありません。worker /
container / resource はそれぞれ個別 record として存在し、group は `group_id` と
snapshot metadata でそれらを同じ inventory / lifecycle scope に載せます。group
なし primitive も、group 所属 primitive も、個別 API と runtime adapter 上は同じ
primitive です。

## Manifest format

`.takos/app.yml` は flat YAML。既定の deploy manifest path で、`.takos/app.yaml`
も受け付ける。ファイル名には `app` が残るが、意味上は primitive desired
declaration です。トップレベルに name, compute, routes, publish を並べる。

```yaml
name: my-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
        inject:
          env:
            endpoint: TAKOS_API_ENDPOINT
            apiKey: TAKOS_API_KEY

publish:
  - name: search
    type: takos.mcp-server.v1
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http

routes:
  - id: ui
    target: web
    path: /
  - id: mcp
    target: web
    path: /mcp
```

envelope (`apiVersion` / `kind` / `metadata` / `spec`) は無い。全 field
がトップレベル。

## Primitive model

### Workload

`compute` は deployable workload を宣言する。3 形態があり、field
の組み合わせで自動判定される。

| 形態                  | 判定条件                     | 動作                         |
| --------------------- | ---------------------------- | ---------------------------- |
| **Worker**            | `build` あり                 | serverless、request-driven   |
| **Service**           | `image` あり（`build` なし） | 常設、always-on container    |
| **Worker + Attached** | `build` + `containers` あり  | worker に container が紐づく |

worker / service / attached container は `services` と `deployments`
に保存される。group 所属の有無は record の runtime 形態を変えない。

### Resources

SQL / object-store / queue などの stateful capability は `resources` record
として管理する。manifest の `publish` は resource creation ではなく、
typed outputs を共有する catalog です。route publication は route/interface
metadata と route output を公開します。Takos API key / OAuth client は built-in
provider publication として consume します。

resource の abstract type (`sql`, `object-store`, `key-value`, `queue`,
`vector-index`, `analytics-engine`, `secret`, `workflow`, `durable-object`) は
resource API / runtime binding 側で扱う。backend / adapter の選択は
operator-only configuration に閉じる。resource が group に所属していても、
resource CRUD / access / binding の扱いは group なし resource と同じです。

### Routes

`routes` は hostname/path → compute のマッピング。

```yaml
routes:
  - target: web
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000
  - target: web
    path: /
```

hostname は routing layer で管理:

- auto hostname: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug: `{slug}.{TENANT_BASE_DOMAIN}`
- custom domain: 任意（DNS 検証 + SSL）

同じ `path` で HTTP method が重なる route は duplicate として invalid。route
publication は `outputs.*.routeRef` で route を参照するため、`routes[].id` は
manifest 内で一意でなければならない。legacy `publisher + route` を使う場合も、
同じ target/path を複数 route に分けることは invalid。

### Publications / consumes

`publish` は primitive が他者へ共有する typed outputs を宣言する。route
publication は公開 interface metadata です。Takos API key / OAuth client は
built-in provider publication として `consume` で request します。env へは
`compute.<name>.consume` を宣言した consumer にだけ inject される。

publication は space-level catalog entry です。group 所属 publication は group
inventory から作られた projection ですが、catalog lookup と consume injection は
group なし publication と同じ model で扱う。

```yaml
publish:
  - name: tools
    type: takos.mcp-server.v1
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http
  - name: docs
    type: takos.ui-surface.v1
    display:
      title: Docs
      icon: book
    outputs:
      url:
        kind: url
        routeRef: ui
```

consumer は output ごとに env 名を決める。

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

## CLI / API

CLI は manifest / repository / catalog source から primitive declaration を
apply する task-oriented surface を提供する。`takos deploy` / `takos install` は
group snapshot 機能なので group 名を明示し、その group inventory と group
snapshot に参加する。

```bash
takos deploy --space SPACE_ID --group my-app              # group inventory へ apply
takos deploy --plan --space SPACE_ID --group my-app       # 差分プレビュー（non-mutating）
takos install OWNER/REPO --space SPACE_ID --group my-app  # catalog から source を解決して apply
takos rollback GROUP_NAME --space SPACE_ID # group snapshot を再適用
takos uninstall GROUP_NAME --space SPACE_ID
takos group list --space SPACE_ID          # group inventory
takos group show NAME --space SPACE_ID
```

個別 primitive 操作:

- resource: `takos resource` / `takos res` または `/api/resources/*`
- compute / route / custom domain: `/api/services/*`
- publication: `/api/publications/*`

既存 service / resource を後から group inventory に入れたい場合は
`PATCH /api/services/:id/group` / `PATCH /api/resources/:id/group` を呼ぶ。

## Group features

Group と primitive record の責務は次のように分ける。

- worker / service / attached container は `services` と `deployments`
  に保存される
- route は routing / custom-domain record に保存される
- publication は `publications`、consume は `service_consumes` に保存される
- resource は `resources` に保存される
- group は `groups` row として inventory / source metadata / current snapshot
  pointer / reconcile status を持つ
- group snapshot / rollback / uninstall は group inventory に対する機能であり、
  primitive runtime の特別処理ではない

```text
group "my-app":
  groups row:
    inventory / source metadata / current snapshot pointer / reconcile status
  group features:
    plan / apply / snapshot / rollback / uninstall
  inventory:
    service: web
    route: /
    publication: files
    resource: shared-cache

group なし primitive:
  service: cron-job
  resource: shared-db
  route/custom-domain: redirect
```

## Deploy pipeline

`takos deploy` / `takos deploy --plan` が public deploy entrypoint。group apply
の HTTP API path も同じ内部 pipeline を通る。

1. Desired declaration の生成
   - deploy manifest を parse して primitive desired declaration に compile
   - group が指定されている場合は group membership を付与する
2. Diff
   - worker / service / attached container / route / publication / consume を現在
     state と比較
   - resource creation は resource API 側の責務として扱う
3. Workload apply
   - worker / service / attached container を topological order で apply
   - per-compute `depends` で順序を制御
4. Managed-state sync
   - publication catalog を同期
   - Takos built-in provider publication consume を検証し、
     `compute.<name>.consume` を宣言した consumer の env に inject
5. Routing reconcile
   - workload apply と managed-state sync が成功した場合だけ route を reconcile
6. Snapshot update
   - group がある場合は group-scoped declaration / observed state / snapshot
     pointer を更新する

## Rollback

rollback は group snapshot を再適用する group 機能です。

- code + config + bindings が戻る
- DB data は戻らない（forward-only migration）
- resource の data / schema は自動巻き戻ししない
- group なし primitive の個別 rollback は、その primitive API の contract に従う

## Install / version / source tracking

`takos install` は catalog (Store) で発見した repository を
`takos deploy URL --ref ...` へ解決する薄い wrapper です。Store 自体は発見と
source 解決だけを担当します。

repo deploy / install の version は catalog が解決する Git ref / tag
が基準です。manifest の `version` field は display 用。

```yaml
name: my-app
version: "1.2.0" # display 用。Git tag と一致させる慣習
```

group がある場合、source 情報を group metadata と snapshot に保存します。

- `local`: takos deploy で手元から deploy
- `repo:owner/repo@v1.2.0`:
  `takos install owner/repo --version v1.2.0 --space SPACE_ID --group NAME` で
  catalog が解決した repo/ref から deploy

## まとめ

```text
Takos deploy system (primitive-first):

  Primitive records
    - services + deployments (worker / service / attached)
    - resources (sql / object-store / kv / queue / vector / secret / ...)
    - routes / custom domains
    - publications / consumes

  Optional group scope
    - groups row
    - inventory / source metadata / current snapshot pointer / reconcile status
    - features: plan / apply / snapshot / rollback / uninstall / updates

  CLI / API surface
    - deploy:    takos deploy / install
    - group:     takos group / rollback / uninstall
    - resource:  takos resource / takos res (+ /api/resources/*)
    - compute:   /api/services/*
    - grant:     /api/publications/*
```

group に所属している primitive は group 機能を使える。所属していない primitive
も同じ primitive model で扱われる。
