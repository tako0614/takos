# マニフェストリファレンス

Takos の deploy manifest は primitive desired declaration を宣言する public
contract です。既定の deploy manifest path は `.takos/app.yml` で、
`.takos/app.yaml` も受け付けます。ファイル名には `app` が残りますが、deploy
model では app catalog item ではなく、worker / service / resource / route /
publication と consume request を記述する manifest として扱います。`publish` は
information sharing catalog であり、resource creation や backend 選択、generic
plugin resolver の入口ではありません。

Group は primitive を任意に束ねる state scope です。worker / service / attached
container は `services` / `deployments`、resource は `resources`、publication は
`publications` として個別に存在します。group に所属している primitive は
inventory、snapshot、rollback、uninstall などの group 機能を使えますが、runtime
や resource binding の扱いは group なし primitive と同じです。

## 1. top-level fields

| field       | required | type   | 説明                                   |
| ----------- | -------- | ------ | -------------------------------------- |
| `name`      | yes      | string | display 名。deploy / install では既定の group 名にもなる |
| `version`   | no       | string | semver の display 用 version           |
| `compute`   | no       | object | workload map                           |
| `resources` | no       | object | managed resource map                   |
| `routes`    | no       | array  | route 定義                             |
| `publish`   | no       | array  | information sharing catalog            |
| `env`       | no       | object | top-level env                          |
| `overrides` | no       | object | 環境別 override                        |

未知 field は deploy 前に invalid です。拡張データは route publication の `spec`
など、明示された object に入れます。

## 2. compute

### 2.1 Worker

`build` を持つ compute は worker です。

| field                             | required | type   | 説明                                                                    |
| --------------------------------- | -------- | ------ | ----------------------------------------------------------------------- |
| `icon`                            | no       | string | publisher launcher image URL/path。UiSurface `spec.icon` の fallback     |
| `build.fromWorkflow.path`         | yes      | string | workflow path                                                           |
| `build.fromWorkflow.job`          | yes      | string | job 名                                                                  |
| `build.fromWorkflow.artifact`     | yes      | string | artifact 名                                                             |
| `build.fromWorkflow.artifactPath` | no       | string | local/private build metadata。bundle file または一意な bundle directory |
| `readiness`                       | no       | string | readiness probe path。HTTP 200 のみ ready                               |
| `containers`                      | no       | object | attached container map                                                  |
| `triggers.schedules`              | no       | array  | cron schedule                                                           |
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

| field         | required | type   | 説明                                                   |
| ------------- | -------- | ------ | ------------------------------------------------------ |
| `icon`        | no       | string | publisher launcher image URL/path。UiSurface `spec.icon` の fallback |
| `image`       | yes      | string | digest-pinned image                                    |
| `port`        | yes      | number | listen port                                            |
| `dockerfile`  | no       | string | `image` 併用時の local build metadata                  |
| `healthCheck` | no       | object | health check                                           |
| `volumes`     | no       | object | parser / desired metadata。runtime へ直接 apply しない |
| `scaling`     | no       | object | parser / desired metadata。runtime へ直接 apply しない |
| `consume`     | no       | array  | publication consume                                    |
| `env`         | no       | object | local env                                              |
| `depends`     | no       | array  | compute 依存                                           |

`dockerfile` だけの Service は online deploy source としては不十分です。Service
deploy は digest-pinned `image` を基準にし、`dockerfile` は local/private
builder metadata として保持します。Service は image-backed runtime に渡す listen
port を推測しないため、`port` が必須です。

### 2.3 Attached container

worker の `containers` 配下に定義します。

| field         | required      | type   | 説明                                                      |
| ------------- | ------------- | ------ | --------------------------------------------------------- |
| `image`       | online deploy | string | digest-pinned container image (64-hex `sha256` digest)    |
| `port`        | yes           | number | listen port                                               |
| `env`         | no            | object | local env                                                 |
| `healthCheck` | no            | object | health check                                              |
| `volumes`     | no            | object | parser / desired metadata。runtime へ直接 apply しない    |
| `scaling`     | no            | object | parser / desired metadata。runtime へ直接 apply しない    |
| `consume`     | no            | array  | publication consume                                       |
| `depends`     | no            | array  | compute 依存                                              |
| `dockerfile`  | local only    | string | local/private build 用。online deploy では `image` も必要 |
| `cloudflare.container` | no | object | native Cloudflare Containers metadata |

`dockerfile` は `image` と併用する local/private builder metadata です。
`dockerfile` だけの attached container は current public deploy manifest として
invalid です。online deploy する場合は digest-pinned `image` が必須。Attached
container も runtime binding / health check の接続先を推測しないため、`port`
が必須です。

`cloudflare.container` を指定した attached container は、generic attached workload
ではなく parent worker の native Cloudflare Containers metadata として deploy
されます。この場合、`image` は digest-pinned image ref または
repository-relative Dockerfile path を許可します。

| field | required | type | 説明 |
| ----- | -------- | ---- | ---- |
| `className` | yes | string | worker bundle が export する Durable Object class |
| `binding` | no | string | DO namespace binding 名（current public contract） |
| `instanceType` | no | string | `lite` / `basic` / `standard-1..4` |
| `maxInstances` | no | number | Cloudflare Containers max instances |
| `name` | no | string | Cloudflare container name metadata |
| `imageBuildContext` | no | string | repository-relative build context metadata |
| `imageVars` | no | object | image build env metadata |
| `rolloutActiveGracePeriod` | no | number | rollout grace period metadata |
| `rolloutStepPercentage` | no | number or array | rollout step metadata |
| `migrationTag` | no | string | DO migration tag。default `v1` |
| `sqlite` | no | boolean | default `true`; `false` の時だけ legacy DO class migration |

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
    env:
      endpoint: INTERNAL_TAKOS_API_URL
      apiKey: INTERNAL_TAKOS_API_KEY
```

| field         | required | type   | 説明                                       |
| ------------- | -------- | ------ | ------------------------------------------ |
| `publication` | yes      | string | catalog publication 名または system source |
| `as`          | no       | string | compute-local consume 名                   |
| `request`     | no       | object | system publication source への request     |
| `env`         | no       | object | output 名 -> env 名 alias                  |

`publication` は同じ space の publication catalog 名、または Takos が公開する
system publication source（`takos.api-key`, `takos.oauth-client`）を参照します。
`as` がある場合は `as`、ない場合は `publication` が compute-local consume 名
です。同じ compute 内で同じ local consume 名を重複させないでください。

`consume.env` は output filter ではなく alias map です。publication の全
outputs が inject 対象になり、`env` に書いた output だけ env 名を上書きします。
未指定の output は default env 名を使います。`env` の値は任意文字列ではなく
`[A-Za-z_][A-Za-z0-9_]*` に一致する必要があります。保存時と注入時には uppercase
に正規化されます。

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

| field      | required | type            | 説明                                 |
| ---------- | -------- | --------------- | ------------------------------------ |
| `type`     | yes      | string          | resource type                        |
| `bindings` | no       | object or array | compute target -> binding name（current public contract） |
| `bind`     | no       | string          | `to` と併用する shorthand binding 名（current public contract） |
| `to`       | no       | string or array | `bind` の target compute 名          |
| `generate` | no       | boolean         | secret などで自動生成する intent     |

`type` は `sql` / `object-store` / `key-value` / `queue` / `vector-index` /
`secret` / `analytics-engine` / `workflow` / `durable-object` のいずれかです。
`bindings` の target は top-level `compute` 名です（current public contract）。
attached container は
親 worker 経由で使うため、binding target にはできません。

binding 名は `[A-Za-z_][A-Za-z0-9_]*` に一致する必要があり、parser が uppercase
に正規化します。同じ workload で同名 binding を複数 resource に割り当てると
deploy 時に失敗します。

## 5. triggers

```yaml
triggers:
  schedules:
    - cron: "0 * * * *"
```

schedule trigger は `triggers.schedules` に宣言します。

## 6. depends

`depends` は同一 manifest の compute 名だけを参照します。

```yaml
depends:
  - api
```

## 7. routes

```yaml
routes:
  - target: web
    path: /
    methods: [GET, POST]
    timeoutMs: 30000
```

| field       | required | type     | 説明              |
| ----------- | -------- | -------- | ----------------- |
| `target`    | yes      | string   | compute 名        |
| `path`      | yes      | string   | `/` で始まる path |
| `methods`   | no       | string[] | allowed methods   |
| `timeoutMs` | no       | number   | timeout           |

`routes[]` の dispatch では path と method で最長一致を選択します。`methods`
省略時は全 HTTP method を意味します。同じ `path` で method が重なる route は
duplicate として invalid です。

route publication は `publisher + route` で route を参照します。そのため同じ
`publisher + route` を複数 route に分けることは invalid です。method
を分けたい場合も、endpoint は 1 つの route にまとめて `methods` に列挙します。

## 8. publish catalog

`publish` は primitive が space-level publication catalog に出す desired entries
です。route publication は endpoint metadata と route output を共有します。
`publish` 自体は resource creation や backend selection、generic plugin resolver
ではありません。Takos の API key / OAuth client は `publish[]` に
`publisher: takos` として書かず、`compute.<name>.consume[]` で
`takos.api-key` / `takos.oauth-client` を consume します。

manifest 由来の publication は primitive declaration の projection として
保存されますが、catalog 名は space 内で一意です。route publication は
manifest-managed entry です。

backend 名は manifest には書きません。backend / adapter の選択は operator-only
runtime configuration で解決されます。SQL / object-store / queue などの resource
type は resource API / runtime binding の対象であり、Takos system publication source
ではありません。

### 8.1 route publication

```yaml
publish:
  - name: search
    type: McpServer
    publisher: web
    outputs:
      url:
        route: /mcp
    spec:
      transport: streamable-http
```

required fields:

| field       | required | type   | 説明                             |
| ----------- | -------- | ------ | -------------------------------- |
| `name`      | yes      | string | publication 名                   |
| `publisher` | yes      | string | 対応する route の compute target |
| `type`      | yes      | string | custom route publication type    |
| `outputs`   | yes      | object | output 名 -> route descriptor    |

optional route metadata:

- `title`
- `spec`

route publication の `type` は custom string です。`McpServer` / `UiSurface`
などの custom type では core は `spec` を opaque object として保存し、platform /
app が解釈します。`FileHandler` だけは platform contract として core parser が
検証します。`FileHandler` の route output は `:id` segment を含む必要があり、`spec` は
`mimeTypes` / `extensions` の少なくとも一方を持てます。両方を指定することも
できます。

`UiSurface` は app launcher / アプリ一覧の entry としても扱われます。launcher
metadata として `spec.description` / `spec.icon` / `spec.category` /
`spec.sortOrder` を指定できます。`spec.launcher: false` の entry は一覧に出ません。
`spec.icon` を省略した場合は、`publisher` が指す `compute.<name>.icon` を
launcher icon として使います。`spec.icon` / `compute.<name>.icon` は HTTPS URL
または publisher origin からの root-relative path（例: `/icons/app.png`）を推奨
します。

各 `outputs.*.route` は `routes[]` の 1 件に一致する必要があります。同じ path を
publisher で分ける場合も、publication は `publisher` で対象 route を明示します。
manifest 全体で同じ `publisher + route` が複数件に一致する状態は invalid です。
route output は assigned hostname と宣言した `route` から生成されます。
`/files/:id` のような path template は許可され、output の URL も template URL
として consumer に渡ります。

route publication は manifest-managed entry です。`/api/publications/:name` から
MCP / FileHandler / UiSurface などの route publication を直接作る運用は
推奨しません。

### 8.2 Takos system publication source

```yaml
consume:
  - publication: takos.api-key
    as: takos-api
    request:
      scopes:
        - files:read
```

| field         | required | type   | 説明                                       |
| ------------- | -------- | ------ | ------------------------------------------ |
| `publication` | yes      | string | `takos.api-key` または `takos.oauth-client` |
| `as`          | no       | string | local consume 名                           |
| `request`     | yes      | object | source-specific request                    |
| `env`         | no       | object | output 名 -> env 名 alias                  |

Takos が公開する情報も他の publication と同じ `consume` contract で扱います。
`publisher: takos` は app manifest の `publish[]` には書きません。output は
`consume.env` で alias できます。alias を省略した output は default env 名を使います。

### 8.3 Takos system publication sources

以下の Takos system publication source だけを受け付け、未知の `request` field は
deploy validation で invalid です。

| source               | required request fields  | outputs                              |
| -------------------- | ------------------------ | ------------------------------------ |
| `takos.api-key`      | `scopes`                 | `endpoint`, `apiKey`                 |
| `takos.oauth-client` | `redirectUris`, `scopes` | `clientId`, `clientSecret`, `issuer` |

`redirectUris` は HTTPS が基本です。manifest では `/api/auth/callback` のような
相対 path も書けます。この場合は deploy 時に group の auto hostname へ解決される
ため、`TENANT_BASE_DOMAIN` と space / group slug から hostname を解決できる必要が
あります。local development では `localhost`, `127.0.0.1`, `[::1]`,
`.localhost` の HTTP URI も受け付けます。`clientName` と `metadata.*` は
optional です。`metadata` 配下は `logoUri` / `tosUri` / `policyUri` を
受け付けます。

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
```

`overrides.<env>` で指定できる field は `compute`, `routes`, `publish`, `env`
だけです。未知 field と retired field は invalid です。

merge rule:

- `compute`: compute 名ごとに deep merge し、merge 後の full compute
  として再検証します。Service / Attached container を追加または変更する場合も
  `port` は必須です。
- `routes`: base の `routes` array を環境別 array で全置換します。merge 後に
  target と duplicate policy を再検証します。
- `publish`: `name` がある override entry は同名 publication に deep merge
  します。`name` がない entry は同じ index の base entry に merge
  します。対応する base entry がなければ追加されます。
- `env`: shallow merge です。同名 key は override 側が勝ちます。merge 後に
  consumed publication output との env collision を再検証します。
