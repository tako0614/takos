# マニフェストリファレンス

Takos の deploy manifest は primitive desired declaration を宣言する public
contract です。既定の deploy manifest path は `.takos/app.yml` で、
`.takos/app.yaml` も受け付けます。ファイル名には `app` が残りますが、deploy
model では app catalog item ではなく、worker / service / resource / route /
publication と consume request を記述する manifest として扱います。`publish` は
typed outputs publication catalog であり、resource creation や backend 選択、
generic plugin resolver の入口ではありません。

Group は primitive declaration を任意に束ねる compatibility state scope です。
worker / service / attached container、resource、publication は authoring/API
projection として個別に扱われ、`takos-paas` Core では descriptor-pinned
`Deployment` (input + resolution + desired) と `GroupHead` ポインタへ投影されます。
group に所属している primitive projection は inventory、deployment history、
rollback、uninstall などの group 機能を使えますが、runtime や resource binding
の扱いは group なし primitive と同じです。Core が `worker` / `service` / `sql`
などを built-in kind として持つという意味ではありません。

この manifest contract と group 機能は `takos/paas` の PaaS control plane が
提供する canonical semantics です。`POST /api/public/v1/deployments` (Deployment
lifecycle endpoint) を通じて preview / resolve / apply / rollback の 4 mode を
扱います。split repo の `former deploy compatibility shell は manifest fetch /
parse、persistent deployment history、rollback を実装していません。

## 0. Canonical minimal manifest {#canonical-minimal-manifest}

以下は Takos の canonical minimal manifest example です。`get-started/` /
`apps/` / `deploy/` / `examples/` 章で minimal example を出すときは、この yaml
を引用するか、これに変形・追加するだけにしてください。**章ごとに別の minimal
manifest を出さないこと**。

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

routes:
  - id: web
    target: web
    path: /
```

ポイント:

- `name` は display 名であり、deploy 時の既定 group 名でもある
  (`--group` で override 可能)
- `compute.web.build.fromWorkflow` で `.takos/workflows/deploy.yml` の `bundle`
  job を referenced workflow とする
- `routes[0].id` は publication が `outputs.*.routeRef` で参照するための
  stable id
- top-level `version` / `publish` / `consume` / `resources` / `env` /
  `overrides` は optional

完全な field の意味は § 1 以降を参照してください。

## 1. top-level fields

| field          | required | type   | 説明                                                     |
| -------------- | -------- | ------ | -------------------------------------------------------- |
| `name`         | yes      | string | display 名。deploy / install では既定の group 名にもなる |
| `version`      | no       | string | semver の display 用 version                             |
| `compute`      | no       | object | workload map                                             |
| `resources`    | no       | object | managed resource map                                     |
| `routes`       | no       | array  | route 定義                                               |
| `publish`      | no       | array  | typed outputs publication catalog                        |
| `publications` | no       | array  | `publish` の preferred alias                             |
| `env`          | no       | object | top-level env                                            |
| `overrides`    | no       | object | 環境別 override                                          |

未知 field は deploy 前に invalid です。拡張データは route publication の `spec`
など、明示された object に入れます。`publish` と `publications` を同時に書く
manifest は invalid です。

## 2. compute

### 2.1 Worker

`build` を持つ compute は worker です。

| field                             | required | type   | 説明                                                                    |
| --------------------------------- | -------- | ------ | ----------------------------------------------------------------------- |
| `icon`                            | no       | string | publisher launcher image URL/path。`takos.ui-surface.v1` `display.icon` の fallback |
| `build.fromWorkflow.path`         | yes      | string | workflow path                                                           |
| `build.fromWorkflow.job`          | yes      | string | job 名                                                                  |
| `build.fromWorkflow.artifact`     | yes      | string | artifact 名                                                             |
| `build.fromWorkflow.artifactPath` | no       | string | local/private build metadata。bundle file または一意な bundle directory |
| `readiness`                       | no       | string | readiness probe path。HTTP 200 のみ ready                               |
| `containers`                      | no       | object | attached container map                                                  |
| `triggers.schedules`              | no       | array  | cron schedule                                                           |
| `triggers.queues`                 | no       | array  | queue consumer trigger                                                  |
| `consume`                         | no       | array  | publication consume                                                     |
| `env`                             | no       | object | local env                                                               |
| `depends`                         | no       | array  | compute 依存                                                            |
| `scaling`                         | no       | object | parser / desired metadata。runtime へ直接 apply しない                  |

`build.fromWorkflow.path` は `.takos/workflows/` 配下である必要があります。
`build.fromWorkflow.artifactPath` は local/private build metadata です。指定する
場合は repository relative path で、絶対パスと `..` path traversal
は使えません。`artifactPath` は artifact 内の単一 bundle file、または `.js` /
`.mjs` / `.cjs` が 1 つだけに定まる directory artifact を指します。複数の
JavaScript file に分かれる module graph は、現行の local artifact collection
path では扱いません。`readiness` は HTTP 200 のみ ready で、201 / 204 / 3xx /
4xx / 5xx / timeout (10s) は fail です。

### 2.2 Service

`image` を持つ compute は service です。

| field         | required | type   | 説明                                                                    |
| ------------- | -------- | ------ | ----------------------------------------------------------------------- |
| `icon`        | no       | string | publisher launcher image URL/path。`takos.ui-surface.v1` `display.icon` の fallback |
| `image`       | yes      | string | digest-pinned image                                                     |
| `port`        | yes      | number | listen port                                                             |
| `dockerfile`  | no       | string | `image` 併用時の local build metadata                                   |
| `healthCheck` | no       | object | health check                                                            |
| `volumes`     | no       | object | parser / desired metadata。runtime へ直接 apply しない                  |
| `scaling`     | no       | object | parser / desired metadata。runtime へ直接 apply しない                  |
| `consume`     | no       | array  | publication consume                                                     |
| `env`         | no       | object | local env                                                               |
| `depends`     | no       | array  | compute 依存                                                            |

`dockerfile` だけの Service は online deploy source としては不十分です。Service
deploy は digest-pinned `image` を基準にし、`dockerfile` は local/private
builder metadata として保持します。Service は image-backed runtime に渡す listen
port を推測しないため、`port` が必須です。

### 2.3 Attached container

worker の `containers` 配下に定義します。

| field                  | required      | type   | 説明                                                      |
| ---------------------- | ------------- | ------ | --------------------------------------------------------- |
| `image`                | online deploy | string | digest-pinned container image (64-hex `sha256` digest)    |
| `port`                 | yes           | number | listen port                                               |
| `env`                  | no            | object | local env                                                 |
| `healthCheck`          | no            | object | health check                                              |
| `volumes`              | no            | object | parser / desired metadata。runtime へ直接 apply しない    |
| `scaling`              | no            | object | parser / desired metadata。runtime へ直接 apply しない    |
| `consume`              | no            | array  | publication consume                                       |
| `depends`              | no            | array  | compute 依存                                              |
| `dockerfile`           | local only    | string | local/private build 用。online deploy では `image` も必要 |
| `cloudflare.container` | no            | object | native Cloudflare Containers metadata                     |

`dockerfile` は `image` と併用する local/private builder metadata です。
`dockerfile` だけの attached container は current public deploy manifest として
invalid です。online deploy する場合は digest-pinned `image` が必須。Attached
container も runtime binding / health check の接続先を推測しないため、`port`
が必須です。

Attached container も Worker / Service と同じ publish / consume contract の
consumer になれます。ただし attached container は `routes[].target` ではなく、
public route publication の `publisher` にもしません。外部公開が必要な場合は親
Worker / Service が route と publication を公開し、親から attached container を
呼び出します。

`cloudflare.container` を指定した attached container は、generic attached
workload ではなく parent worker の native Cloudflare Containers metadata として
deploy されます。この場合、`image` は digest-pinned image ref または
repository-relative Dockerfile path を許可します。

| field                      | required | type            | 説明                                                       |
| -------------------------- | -------- | --------------- | ---------------------------------------------------------- |
| `className`                | yes      | string          | worker bundle が export する Durable Object class          |
| `binding`                  | no       | string          | DO namespace binding 名（current public contract）         |
| `instanceType`             | no       | string          | `lite` / `basic` / `standard-1..4`                         |
| `maxInstances`             | no       | number          | Cloudflare Containers max instances                        |
| `name`                     | no       | string          | Cloudflare container name metadata                         |
| `imageBuildContext`        | no       | string          | repository-relative build context metadata                 |
| `imageVars`                | no       | object          | image build env metadata                                   |
| `rolloutActiveGracePeriod` | no       | number          | rollout grace period metadata                              |
| `rolloutStepPercentage`    | no       | number or array | rollout step metadata                                      |
| `migrationTag`             | no       | string          | DO migration tag。default `v1`                             |
| `sqlite`                   | no       | boolean         | default `true`; `false` の時だけ legacy DO class migration |

## 3. consume

`consume` は compute が publication output を env として受け取る service-level
dependency edge です。manifest 上では compute に書きますが、実体は deploy 時に
対象 service の `service_consumes` record へ同期されます。manifest で管理する
service では、次回 deploy 時に service consume 設定を manifest の内容で
置き換えます。

```yaml
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

| field             | required | type    | 説明                                                       |
| ----------------- | -------- | ------- | ---------------------------------------------------------- |
| `publication`     | yes      | string  | catalog publication 名または built-in provider publication |
| `as`              | no       | string  | compute-local consume 名                                   |
| `request`         | no       | object  | provider publication への request                          |
| `inject.env`      | no       | object  | output 名 -> env 名 explicit inject map                    |
| `inject.defaults` | no       | boolean | 全 outputs を default env 名で inject                      |
| `env`             | no       | object  | legacy shorthand for `inject.env`                          |

`publication` は同じ space の publication catalog 名、または Takos が公開する
built-in provider publication（`takos.api-key`,
`takos.oauth-client`）を参照します。 `as` がある場合は `as`、ない場合は
`publication` が compute-local consume 名 です。同じ compute 内で同じ local
consume 名を重複させないでください。

`inject.env` は explicit output inject map です。明示した output だけ inject
されます。全 outputs を default env 名で inject したい場合は
`inject.defaults: true` を書きます。`env` の値は任意文字列ではなく
`[A-Za-z_][A-Za-z0-9_]*` に一致する必要があります。保存時と注入時には uppercase
に正規化されます。legacy `consume.env` も受け付けますが、`inject.env` と同じ
明示 output inject として扱います。

SQL / object-store / queue などの resource access は publish / consume
ではなく、`resources` か resource API / runtime binding 側で扱います。

## 4. resources

`resources` は manifest-managed resource を作成・更新・削除し、必要に応じて
compute へ runtime binding として同期します。resource は group inventory
に所属し、workload deploy の前に reconcile されます。target を絞った partial
deploy は resource binding 同期と整合しないため、`resources` を持つ manifest
では無効です。

```yaml
resources:
  session-index:
    type: key-value
    # current public contract
    bindings:
      web: SESSION_INDEX # current public contract
  host-token:
    type: secret
    generate: true
    # current public contract
    bindings:
      web: SANDBOX_HOST_AUTH_TOKEN # current public contract
```

| field      | required | type            | 説明                                                            |
| ---------- | -------- | --------------- | --------------------------------------------------------------- |
| `type`     | yes      | string          | resource type                                                   |
| `bindings` | no       | object or array | compute target -> binding name（current public contract）       |
| `bind`     | no       | string          | `to` と併用する shorthand binding 名（current public contract） |
| `to`       | no       | string or array | `bind` の target compute 名                                     |
| `generate` | no       | boolean         | secret などで自動生成する intent                                |

`type` は `sql` / `object-store` / `key-value` / `queue` / `vector-index` /
`secret` / `analytics-engine` / `workflow` / `durable-object` のいずれかです。
`bindings` の target は top-level `compute` 名です（current public contract）。
attached container は 親 worker 経由で使うため、binding target にはできません。

binding 名は `[A-Za-z_][A-Za-z0-9_]*` に一致する必要があり、parser が uppercase
に正規化します。同じ workload で同名 binding を複数 resource に割り当てると
deploy 時に失敗します。

## 5. triggers

```yaml
triggers:
  schedules:
    - cron: "0 * * * *"
  queues:
    - binding: JOBS
      deadLetterQueue: JOBS_DLQ
      maxBatchSize: 10
      maxRetries: 3
```

schedule trigger は `triggers.schedules` に宣言します。queue consumer は
`triggers.queues` に宣言し、通常は worker に bind した queue binding 名を
`binding` で参照します。`queue` に backing queue
名を直接指定することもできます。

| field               | required | type   | 説明                                  |
| ------------------- | -------- | ------ | ------------------------------------- |
| `binding`           | one of   | string | worker queue binding 名。uppercase 化 |
| `queue`             | one of   | string | backing queue 名                      |
| `deadLetterQueue`   | no       | string | DLQ 名                                |
| `maxBatchSize`      | no       | number | batch size                            |
| `maxConcurrency`    | no       | number | concurrency                           |
| `maxRetries`        | no       | number | retry count                           |
| `maxWaitTimeMs`     | no       | number | batch wait time                       |
| `retryDelaySeconds` | no       | number | retry delay                           |

`binding` と `queue` は同時には指定できません。`triggers` は worker compute
だけで使えます。

## 6. depends

`depends` は同一 manifest の compute 名だけを参照します。

```yaml
depends:
  - api
```

## 7. routes

```yaml
routes:
  - id: web
    target: web
    path: /
    methods: [GET, POST]
    timeoutMs: 30000
```

| field       | required | type     | 説明              |
| ----------- | -------- | -------- | ----------------- |
| `id`        | no       | string   | routeRef 用 ID    |
| `target`    | yes      | string   | compute 名        |
| `protocol`  | no       | string   | `https` default   |
| `path`      | HTTP     | string   | `/` で始まる path |
| `port`      | TCP/UDP  | number   | listener port     |
| `source`    | event 系 | string   | event source      |
| `methods`   | HTTP     | string[] | allowed methods   |
| `timeoutMs` | no       | number   | timeout           |

`.takos/app.yml` で使う public manifest の route は `routes[]` の array で
書き、HTTP/HTTPS は `path`、TCP/UDP は `port`、queue / schedule / event は
`source` で入口を表します。PaaS manifest compiler の互換 surface では record
form、`to` alias、`host` も受け付けます。`protocol` は `https` default で、
`http` / `https` / `tcp` / `udp` / `queue` / `schedule` / `event` をサポートします。

`routes[]` の dispatch では path と method で最長一致を選択します。`methods`
省略時は全 HTTP method を意味します。同じ `path` で method が重なる route は
duplicate として invalid です。CLI はさらに同じ `target + path` を複数 route
に分けることも invalid として扱います。PaaS compiler の HTTP/HTTPS route
validation は `target + host + path + methods` の重複を検出します。

route publication は `outputs.*.routeRef` で `routes[].id`
を参照します。そのため 公開したい endpoint は stable な `id` を持つ 1 つの route
にまとめて、method を分けたい場合も `methods` に列挙します。legacy
`publisher + route` も 受け付けますが、同じ target/path が複数 route
に一致する状態は invalid です。

PaaS compiler の event route surface では `protocol: queue` /
`protocol: schedule` / `protocol: event` と `source` を使って event subscription
を表せます。この場合 `source` は queue / schedule / event source 名で、省略時は
route 名が使われます。HTTP/HTTPS route では `source` は使いません。

## 8. publish catalog

`publish` は primitive が space-level publication catalog に出す typed outputs
の desired entries です。route publication は endpoint metadata と route output
を共有します。 `publish` 自体は resource creation や backend selection、generic
plugin resolver ではありません。Takos の API key / OAuth client は `publish[]`
に `publisher: takos` として書かず、`compute.<name>.consume[]` で
`takos.api-key` / `takos.oauth-client` を consume します。

manifest 由来の publication は primitive declaration の projection として
保存されます。`publish[].name` は group-local で、他 group からは
`<group>/<name>` で参照します。route publication は manifest-managed entry
です。

backend 名は manifest には書きません。backend / adapter の選択は operator-only
runtime configuration で解決されます。SQL / object-store / queue などの resource
type は resource API / runtime binding の対象であり、Takos built-in provider
publication ではありません。

### 8.1 route publication

```yaml
publish:
  - name: search
    type: takos.mcp-server.v1
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http
```

required fields:

| field     | required | type   | 説明                              |
| --------- | -------- | ------ | --------------------------------- |
| `name`    | yes      | string | publication 名                    |
| `type`    | yes      | string | namespaced route publication type |
| `outputs` | yes      | object | output 名 -> route descriptor     |

optional route metadata:

- `display`
- `auth`
- `title` (legacy shorthand for `display.title`)
- `spec`

route publication の `type` は custom string です。Takos 標準 type と legacy
alias の対応は
[Glossary § Publication types](/reference/glossary#publication-types) を参照。
core は `spec` を consumer-facing metadata として保存し、 platform / app
が解釈します。`auth` は platform-managed behavior です。
`takos.file-handler.v1` の route output は `:id` segment
を含む必要があり、`spec` は `mimeTypes` / `extensions`
の少なくとも一方を持てます。両方を指定することも できます。

`takos.ui-surface.v1` は app launcher / アプリ一覧の entry としても扱われます。
launcher metadata として `display.description` / `display.icon` /
`display.category` / `display.sortOrder` を指定できます。`spec.launcher: false`
の entry は一覧に出ません。 `display.icon` を省略した場合は、route target の
`compute.<name>.icon` を launcher icon として使います。`display.icon` /
`compute.<name>.icon` は HTTPS URL または publisher origin からの root-relative
path（例: `/icons/app.png`）を推奨 します。

各 `outputs.*.routeRef` は `routes[].id` の 1 件に一致する必要があります。legacy
互換として `publisher + outputs.*.route` も受け付けます。manifest 全体で同じ
route target/path を複数 publication が公開する状態は invalid です。 route
output は assigned hostname と参照先 route の `path` から生成されます。
`/files/:id` のような path template は許可され、output の URL も template URL
として consumer に渡ります。

route publication は manifest-managed entry です。`/api/publications/:name` から
`takos.mcp-server.v1` / `takos.file-handler.v1` / `takos.ui-surface.v1` などの
route publication を直接作る運用は推奨しません。

### 8.2 Takos built-in provider publication

```yaml
consume:
  - publication: takos.api-key
    as: takos-api
    request:
      scopes:
        - files:read
```

| field         | required | type   | 説明                                        |
| ------------- | -------- | ------ | ------------------------------------------- |
| `publication` | yes      | string | `takos.api-key` または `takos.oauth-client` |
| `as`          | no       | string | local consume 名                            |
| `request`     | yes      | object | source-specific request                     |
| `inject`      | no       | object | output inject rule                          |
| `env`         | no       | object | legacy shorthand for `inject.env`           |

Takos が公開する情報も他の publication と同じ `consume` contract で扱います。
`publisher: takos` は app manifest の `publish[]` には書きません。output は
`consume.inject.env` で alias できます。default env 名で全 output を使う場合は
`inject.defaults: true` を書きます。

### 8.3 Takos built-in provider publications

以下の Takos built-in provider publication だけを受け付け、未知の `request`
field は deploy validation で invalid です。

| source               | required request fields  | outputs                                                            |
| -------------------- | ------------------------ | ------------------------------------------------------------------ |
| `takos.api-key`      | `scopes`                 | `endpoint` (`url`), `apiKey` (`secret`)                            |
| `takos.oauth-client` | `redirectUris`, `scopes` | `clientId` (`string`), `clientSecret` (`secret`), `issuer` (`url`), `tokenEndpoint` (`url`), `userinfoEndpoint` (`url`) |

`redirectUris` は HTTPS が基本です。manifest では `/api/auth/callback` のような
相対 path も書けます。この場合は deploy 時に group の auto hostname へ解決される
ため、`TENANT_BASE_DOMAIN` と space / group slug から hostname
を解決できる必要が あります。local development では `localhost`, `127.0.0.1`,
`[::1]`, `.localhost` の HTTP URI も受け付けます。`clientName` と `metadata.*`
は optional です。`metadata` 配下は `logoUri` / `tosUri` / `policyUri` を
受け付けます。

default injection (`inject.defaults: true`) の対象は `takos.api-key` が
`endpoint` / `apiKey`、`takos.oauth-client` が `clientId` / `clientSecret` /
`issuer` です。`tokenEndpoint` / `userinfoEndpoint` が必要な app は default apps
と同じように `inject.env` で明示します。

## 9. env

```yaml
env:
  NODE_ENV: production
  LOG_LEVEL: info
```

publication outputs と local env が衝突すると deploy / settings update
は失敗します。衝突判定は uppercase 正規化後に行われ、top-level `env`、
`compute.<name>.env`、同一 compute の consumed publication outputs
のいずれかが同じ env 名に解決されると invalid です。

## 10. overrides

```yaml
overrides:
  production:
    env:
      LOG_LEVEL: warn
    compute:
      web:
        scaling:
          minInstances: 2
    resources:
      cache:
        type: key-value
        bindings:
          web: CACHE
    publications:
      - name: web-ui
        display:
          title: Web UI
```

`overrides.<env>` で指定できる field は `compute`, `routes`, `publish` /
`publications`, `resources`, `env` です。未知 field と retired field は invalid
です。

merge rule:

- `compute`: compute 名ごとに deep merge し、merge 後の full compute
  として再検証します。Service / Attached container を追加または変更する場合も
  `port` は必須です。
- `routes`: base の `routes` array を環境別 array で全置換します。merge 後に
  target と duplicate policy を再検証します。
- `publish` / `publications`: override entry は `name` が必須です。同名
  publication に deep merge します。配列 index による merge はしません。
- `resources`: resource 名ごとに deep merge し、merge 後の full resources として
  parse / binding target validation を行います。
- `env`: shallow merge です。同名 key は override 側が勝ちます。merge 後に
  consumed publication output との env collision を再検証します。
