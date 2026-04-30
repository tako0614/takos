# Deploy Manifest (`.takos/app.yml`)

`.takos/app.yml` は既定の deploy manifest path です。ファイル名に `app`
が残りますが、Takos の deploy model では Store / UI の app catalog ではなく、
primitive desired declaration を書く deploy manifest として扱います。worker /
service / route / publication と consume request を記述します。`takos deploy` /
`takos install` では manifest の `name` が group 名として使われ、`--group`
を指定した場合は override されます。作成・更新される primitive は group
inventory に所属し、deployment history / rollback / uninstall などの group
機能を 使えます。`.takos/app.yaml` も受け付けます。

> 現行実装の split status は
> [Current Implementation Note](/takos-paas/current-state#deploy-shell) を参照

Group は primitive を任意に束ねる state scope です。manifest は worker / service
/ attached container / route / publication を宣言しますが、group 自体が runtime
backend や resource provider になるわけではありません。SQL / object-store /
queue などの resource は `resources` record として独立し、resource API / runtime
binding 側で管理します。

## 最小例

最小 manifest の canonical 例は
[Canonical minimal manifest](/reference/manifest-spec#canonical-minimal-manifest)
を参照。詳細仕様は [manifest spec](/reference/manifest-spec) を参照。

## Takos built-in provider publication を consume する例

```yaml
name: notes-app

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
            - files:write
        inject:
          env:
            endpoint: INTERNAL_TAKOS_API_URL
            apiKey: INTERNAL_TAKOS_API_KEY

routes:
  - id: web
    target: web
    path: /
```

## Public interface publication を使う例

```yaml
name: search-agent

compute:
  agent:
    build: ...
  web:
    build: ...
    consume:
      - publication: search
        inject:
          env:
            url: SEARCH_MCP_URL

routes:
  - id: mcp
    target: agent
    path: /mcp

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

publication は自動注入されません。必要な consumer が明示的に `consume` します。

## トップレベルフィールド

| field          | required | 説明                                                     |
| -------------- | -------- | -------------------------------------------------------- |
| `name`         | yes      | display 名。deploy / install では既定の group 名にもなる |
| `version`      | no       | semver の display 用 version                             |
| `compute`      | no       | workload 定義                                            |
| `resources`    | no       | manifest-managed resource と runtime link                |
| `routes`       | no       | path と target の対応                                    |
| `publish`      | no       | typed outputs publication catalog                        |
| `publications` | no       | `publish` の preferred alias                             |
| `env`          | no       | top-level env                                            |
| `overrides`    | no       | 環境別 override                                          |

未知 field は deploy 前に invalid です。custom publication metadata は
`publish[].spec` / `publications[].spec` に入れます。`publish` と `publications`
を同時に書く manifest は invalid です。

## compute

`compute` は workload map です。`build` があれば worker、`image` があれば
service として解釈されます。worker の `containers` 配下は attached container
です。

`compute.<name>.icon` は publisher の launcher image metadata です。HTTPS URL
または publisher origin からの root-relative path（例: `/icons/app.png`）を指定
します。`takos.ui-surface.v1` publication が `display.icon` を持たない場合、アプリ一覧 /
launcher は route target の `compute.<name>.icon` を fallback として使います。

### Worker

```yaml
compute:
  web:
    icon: /icons/search.png
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
```

`build.fromWorkflow.path` は `.takos/workflows/` 配下である必要があります。
`build.fromWorkflow.artifactPath` は repository relative path です。絶対パスと
`..` path traversal は使えません。`artifactPath` は artifact 内の単一 bundle
file、または `.js` / `.mjs` / `.cjs` が 1 つだけに定まる directory artifact
を指します。directory 内に複数の JavaScript bundle 候補がある場合は失敗します。

### Service

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080
```

Service は image-backed runtime に渡す listen port を推測しないため、`port`
が必須です。`image` は `@sha256:<64 hex>` の digest-pinned image ref
である必要があります。

### Attached container

```yaml
compute:
  web:
    build: ...
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 3000
```

Attached container も runtime binding / health check の接続先を推測しないため、
`port` が必須です。`dockerfile` だけの local/private builder 用 manifest でも
`port` は省略できません。

Attached container も Worker / Service と同じ `consume` contract
に参加できます。 ただし public route publication の publisher
にはしません。外部に公開する場合は、 親 Worker / Service を `routes[].target`
にし、publication は `outputs.*.routeRef` でその route を参照します。親から
attached container を 呼び出します。

### Native Cloudflare Containers

Cloudflare Containers の Durable Object class を worker bundle 自体が export
する場合は、attached container に `cloudflare.container` を追加します。この mode
では child container は独立 workload にならず、parent worker の upload metadata
に `containers` / DO migration / DO namespace binding（current public contract）
が含まれます。`image` は digest-pinned image ref、または Cloudflare build
contract 用の repository-relative Dockerfile path を指定できます。

```yaml
compute:
  web:
    build: ...
    containers:
      sandbox:
        image: apps/sandbox/Dockerfile
        dockerfile: apps/sandbox/Dockerfile
        port: 8080
        healthCheck:
          path: /healthz
        cloudflare:
          container:
            binding: SANDBOX_CONTAINER
            className: SandboxSessionContainer
            instanceType: basic
            maxInstances: 100
            imageBuildContext: .
            migrationTag: v1
```

`className` は worker bundle から export される Durable Object class 名です。
`binding` は worker runtime 上の namespace 名で、省略時は child 名から
`<CHILD>_CONTAINER` を生成します。`migrationTag` 省略時は `v1` です。`sqlite` を
明示的に `false` にした場合だけ legacy DO migration を使い、既定では
`new_sqlite_classes` として metadata に出します。

### consume

`consume` は compute が publication output を env として受け取る service-level
dependency edge です。manifest 上では compute に書きますが、deploy 時に対象
service の `service_consumes` record へ同期されます。manifest で管理する service
では、次回 apply 時に manifest の内容で consume 設定を置き換えます。

`consume` は publication source、optional local name、request、inject rule を
持ちます。`publication` は同じ space の catalog 名、または Takos built-in
provider が公開する publication（例: `takos.api-key`,
`takos.oauth-client`）です。 `as` はその compute 内での local consume
名で、stored consume record の識別に 使われます。Takos built-in provider
publication では default env 名にも反映されます。 `request` は provider
publication へ渡す要求です。 `inject.env` は output 名 -> env 名 の explicit
inject map です。明示した output だけが注入されます。全 outputs を default env
名で注入したい場合だけ `inject.defaults: true` を指定します。

`inject.env` の canonical / legacy alias は
[Glossary § Consume env injection](/reference/glossary#consume-env-injection)
を参照。

`inject.env` の env 名は任意文字列ではなく `[A-Za-z_][A-Za-z0-9_]*` に一致する
必要があります。保存時と注入時には uppercase に正規化されます。

同じ compute 内では `as` があれば `as`、なければ `publication` が local consume
名です。同じ local consume 名を重複させないでください。

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

SQL / object-store / queue などの resource access は `consume` ではなく、
`resources` か resource API / runtime binding 側で扱います。

## resources

`resources` は manifest-managed resource を宣言し、必要なら compute へ runtime
binding として同期します。current public contract では resource は
create/update/delete の対象になり、binding は deploy 時に対象 workload の
desired state へ反映されます。

```yaml
resources:
  session-index:
    type: key-value
    bindings:
      web: SESSION_INDEX
  host-token:
    type: secret
    generate: true
    bindings:
      web: SANDBOX_HOST_AUTH_TOKEN
```

`type` は `sql` / `object-store` / `key-value` / `queue` / `vector-index` /
`secret` / `analytics-engine` / `workflow` / `durable-object` を指定します。
`bindings` の key は top-level `compute` 名、value は worker binding 名です
（current public contract）。 binding 名は `[A-Za-z_][A-Za-z0-9_]*`
に一致する必要があり、保存時は uppercase へ正規化されます。

### depends

`depends` は同一 manifest 内の compute 名だけを参照します。

```yaml
compute:
  api:
    build: ...
  jobs:
    build: ...
    depends:
      - api
```

### triggers

現行 contract で使える trigger は `schedules` と `queues` です。

```yaml
triggers:
  schedules:
    - cron: "*/15 * * * *"
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

### healthCheck / readiness

- `healthCheck` は service / attached container 用
- `readiness` は worker 用の deploy readiness probe
- `readiness` の path は HTTP 200 だけを ready とし、201 / 204 / 3xx / 4xx / 5xx
  / timeout (10s) は fail です

```yaml
compute:
  api:
    image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080
    healthCheck:
      path: /health

  web:
    build: ...
    readiness: /mcp
```

## routes

```yaml
routes:
  - id: web
    target: web
    path: /
  - id: api
    target: api
    path: /api
    methods: [GET, POST]
    timeoutMs: 30000
  - id: socket
    target: api
    protocol: tcp
    port: 4433
  - id: jobs
    target: web
    protocol: queue
    source: jobs.incoming
```

`target` は compute 名です。`.takos/app.yml` で使う public manifest の route は
`routes[]` の array で書きます。HTTP/HTTPS は `path`、TCP/UDP は `port`、
queue / schedule / event は `source` で入口を表します。PaaS manifest compiler
の互換 surface では record form、`to` alias、`host` も受け付けます。

`methods` を省略した route は全 HTTP method に一致します。同じ `path` で method
が重なる route は duplicate として invalid です。同じ `target + path` を複数
route に分けることも invalid です。route publication は `outputs.*.routeRef` で
`routes[].id` を参照するため、公開したい endpoint は stable な `id` を持つ 1
つの route にまとめて必要な method を `methods` に列挙します。

PaaS compiler の event route surface では `protocol: queue` /
`protocol: schedule` / `protocol: event` と `source` を使って event subscription
を表せます。この場合 `source` は queue / schedule / event source 名で、省略時は
route 名が使われます。HTTP/HTTPS route では `source` は使いません。

## publish

`publish` は primitive が space-level publication catalog に出す typed outputs
の desired entries です。route publication は endpoint metadata と route output
を共有します。 `publish` 自体は resource creation や backend selection、generic
plugin resolver ではありません。Takos の API key / OAuth client は `publish[]`
に `publisher: takos` として書かず、`compute.<name>.consume[]` で
`takos.api-key` / `takos.oauth-client` を consume します。SQL / object-store /
queue などの resource は publish ではなく resource API / runtime binding 側の
責務です。

manifest 由来の publication は primitive declaration の projection
として保存されます。`publish[].name` は group-local で、他 group からは
`<group>/<name>` で参照します。route publication は manifest-managed entry で、
control plane API から直接作る対象ではありません。

### OAuth client built-in provider publication

```yaml
compute:
  web:
    consume:
      - publication: takos.oauth-client
        as: app-oauth
        request:
          clientName: My App
          redirectUris:
            - https://example.com/callback
          scopes:
            - threads:read
            - runs:write
          metadata:
            logoUri: https://example.com/logo.png
```

`takos.oauth-client` は Takos built-in provider が公開する publication です。
`request.redirectUris` と `request.scopes` は必須です。 `redirectUris` は絶対
HTTPS URL に加えて、manifest では `/api/auth/callback` のような相対 path
も受け付けます。相対 path は deploy 時に group の auto hostname
へ解決されるため、hostname を解決できない環境では validation が失敗します。
`request.clientName` と `request.metadata.*` は任意です。`metadata` 配下は
`logoUri` / `tosUri` / `policyUri` を受け付けます。

### route publication

```yaml
publish:
  - name: search
    type: takos.mcp-server.v1
    display:
      title: Search MCP
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http
```

route publication は `name` / `type` / `outputs` が必須です。route output は
`outputs.<name>.routeRef` で `routes[].id` を参照します。慣例的な main URL は
`outputs.url` です。legacy 互換として `publisher + outputs.*.route`
も受け付けます。`type` は custom string ですが、Takos 標準 type の canonical
名と legacy alias は
[Publication types](/reference/glossary#publication-types) を参照。

`outputs.*.kind` は output の型です。manifest route publication の route-backed
output は `kind: url` です。Takos built-in provider は `secret` / `string` /
`url` を内部 catalog で定義します。`spec` は consumer-facing metadata、`auth` は
platform-managed behavior です。

`takos.ui-surface.v1` は Takos の app launcher / アプリ一覧でも使われます。`spec`
には任意で `launcher` などの behavior metadata を置けます。表示 metadata は
`display.description` / `display.icon` / `display.category` /
`display.sortOrder` に置きます。`display.icon` を省略した場合は、route target の
`compute.<name>.icon` が launcher icon として使われます。`display.icon` /
`compute.<name>.icon` は画像 URL または publisher root-relative path
として扱われます。 `spec.launcher: false` を指定した `takos.ui-surface.v1` は launcher
には表示されません。

各 `outputs.*.routeRef` は `routes[].id` の 1 件に一致する必要があります。
manifest 全体で同じ route target/path を複数 publication が公開する状態は
invalid です。route output の値は assigned hostname と参照先 route の `path`
から 生成されます。`/files/:id` のような path template は許可され、output の URL
も template URL のまま consumer に渡ります。

route publication を削除・変更する場合は manifest の `publish[]` entry
を変更して deploy します。

### Takos built-in provider publications

Takos 自体が公開する情報は `publish[]` に書く特別な裏口ではなく、Takos built-in
provider が公開する publication として `consume[]` から参照します。 未知の
`request` field は deploy validation で invalid です。SQL / object-store / queue
などの resource type はここには入りません。

| publication          | required request fields  | outputs                                                            |
| -------------------- | ------------------------ | ------------------------------------------------------------------ |
| `takos.api-key`      | `scopes`                 | `endpoint` (`url`), `apiKey` (`secret`)                            |
| `takos.oauth-client` | `redirectUris`, `scopes` | `clientId` (`string`), `clientSecret` (`secret`), `issuer` (`url`), `tokenEndpoint` (`url`), `userinfoEndpoint` (`url`) |

`takos.oauth-client` の `clientName` と `metadata.*` は任意です。`metadata`
配下は `logoUri` / `tosUri` / `policyUri` を受け付けます。

default env 名は local consume 名から決まります。たとえば `as: takos-api` の
`endpoint` は `PUBLICATION_TAKOS_API_ENDPOINT` です。default injection
(`inject.defaults: true`) の対象は `takos.api-key` が `endpoint` / `apiKey`、
`takos.oauth-client` が `clientId` / `clientSecret` / `issuer` です。
`tokenEndpoint` / `userinfoEndpoint` が必要な app は default apps と同じように
`inject.env` で明示します。

## overrides

```yaml
overrides:
  production:
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
    env:
      LOG_LEVEL: warn
```

`takos deploy --env production --space SPACE_ID --group my-app` で base manifest
に環境別 override が適用されます。

`overrides.<env>` では `compute`, `routes`, `publish` / `publications`,
`resources`, `env` を指定できます。

merge rule:

- `compute`: compute 名ごとに deep merge し、merge 後の full compute
  として再検証します。Service / Attached container では `port` が必須です。
- `routes`: base の `routes` array を環境別 array で全置換します。
- `publish` / `publications`: `name` が必須です。同名 publication に deep merge
  します。配列 index による merge はしません。
- `resources`: resource 名ごとに deep merge し、merge 後の full resources
  として再検証します。
- `env`: shallow merge です。同名 key は override 側が勝ちます。

merge 後に route target、duplicate route、publication `routeRef`、consume
reference、env collision が再検証されます。

## deploy

```bash
takos deploy --env staging --space SPACE_ID --group my-app
```

deploy manifest の online deploy source は次で解決されます。

- worker: `build.fromWorkflow.artifactPath`
- service / attached container: `image`

direct deploy (`takos deploy image` など) は manifest を bypass しません。PaaS
では generated manifest に `overrides.takos.directDeploy.generated: true`
を付け、通常の Deployment lifecycle (resolve → apply → GroupHead advance)
を通して適用します。image direct deploy は `--port` 未指定時に generated
manifest の `port` を `8080` にしますが、通常の `.takos/app.yml` の Service /
Attached container では `port` を明示する必要があります。既存 group が通常の
manifest 由来の Deployment で管理されている場合、direct deploy は明示 opt-in
なしにその group の GroupHead を変更しません。
