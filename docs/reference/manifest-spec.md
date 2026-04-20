# マニフェストリファレンス

Takos の deploy manifest は primitive desired declaration を宣言する public
contract です。既定の deploy manifest path は `.takos/app.yml` で、
`.takos/app.yaml` も受け付けます。ファイル名には `app` が残りますが、deploy
model では app catalog item ではなく、worker / service / route / publication と
grant を記述する manifest として扱います。`publish` は information sharing
catalog であり、resource creation や backend 選択、generic plugin resolver
の入口ではありません。

Group は primitive を任意に束ねる state scope です。worker / service / attached
container は `services` / `deployments`、resource は `resources`、publication は
`publications` として個別に存在します。group に所属している primitive は
inventory、snapshot、rollback、uninstall などの group 機能を使えますが、runtime
や resource binding の扱いは group なし primitive と同じです。

## 1. top-level fields

| field       | required | type   | 説明                                   |
| ----------- | -------- | ------ | -------------------------------------- |
| `name`      | yes      | string | display 名。group 名には暗黙解決しない |
| `version`   | no       | string | semver の display 用 version           |
| `compute`   | no       | object | workload map                           |
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
| `build.fromWorkflow.path`         | yes      | string | workflow path                                                           |
| `build.fromWorkflow.job`          | yes      | string | job 名                                                                  |
| `build.fromWorkflow.artifact`     | yes      | string | artifact 名                                                             |
| `build.fromWorkflow.artifactPath` | no       | string | local/private build metadata。bundle file または一意な bundle directory |
| `readiness`                       | no       | string | readiness probe path。HTTP 200 のみ ready                               |
| `containers`                      | no       | object | attached container map                                                  |
| `triggers.schedules`              | no       | array  | cron schedule                                                           |
| `consume`                         | no       | array  | publication / grant consume                                             |
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
| `image`       | yes      | string | digest-pinned image                                    |
| `port`        | yes      | number | listen port                                            |
| `dockerfile`  | no       | string | `image` 併用時の local build metadata                  |
| `healthCheck` | no       | object | health check                                           |
| `volumes`     | no       | object | parser / desired metadata。runtime へ直接 apply しない |
| `scaling`     | no       | object | parser / desired metadata。runtime へ直接 apply しない |
| `consume`     | no       | array  | publication / grant consume                            |
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
| `consume`     | no            | array  | publication / grant consume                               |
| `depends`     | no            | array  | compute 依存                                              |
| `dockerfile`  | local only    | string | local/private build 用。online deploy では `image` も必要 |

`dockerfile` は `image` と併用する local/private builder metadata です。
`dockerfile` だけの attached container は current public deploy manifest として
invalid です。online deploy する場合は digest-pinned `image` が必須。Attached
container も runtime binding / health check の接続先を推測しないため、`port`
が必須です。

## 3. consume

`consume` は compute が publication output を env として受け取る service-level
dependency edge です。manifest 上では compute に書きますが、実体は deploy 時に
対象 service の `service_consumes` record へ同期されます。manifest で管理する
service では、次回 deploy 時に service consume 設定を manifest の内容で
置き換えます。

```yaml
consume:
  - publication: takos-api
    env:
      endpoint: INTERNAL_TAKOS_API_URL
      apiKey: INTERNAL_TAKOS_API_KEY
```

| field         | required | type   | 説明                      |
| ------------- | -------- | ------ | ------------------------- |
| `publication` | yes      | string | publication 名            |
| `env`         | no       | object | output 名 -> env 名 alias |

`publication` は同じ space の publication catalog 名を参照します。current
implementation では publication 名は space 内で一意です。別 primitive が公開した
publication や API で作った Takos capability grant も同じ名前空間に入るため、
publication 名を衝突させないでください。

`consume.env` は output filter ではなく alias map です。publication / grant の全
outputs が inject 対象になり、`env` に書いた output だけ env 名を上書きします。
未指定の output は default env 名を使います。`env` の値は任意文字列ではなく
`[A-Za-z_][A-Za-z0-9_]*` に一致する必要があります。保存時と注入時には uppercase
に正規化されます。

同じ compute が同じ publication を重複参照すると invalid です。SQL /
object-store / queue などの resource access は publish / consume
ではなく、resource API / runtime binding 側で扱います。

## 4. triggers

```yaml
triggers:
  schedules:
    - cron: "0 * * * *"
```

schedule trigger は `triggers.schedules` に宣言します。

## 5. depends

`depends` は同一 manifest の compute 名だけを参照します。

```yaml
depends:
  - api
```

## 6. routes

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

route publication は `publisher + path` で route を参照します。そのため同じ
`publisher + path` を複数 route に分けることは invalid です。method
を分けたい場合も、endpoint は 1 つの route にまとめて `methods` に列挙します。

## 7. publish catalog

`publish` は primitive が space-level publication catalog に出す desired entries
です。route publication は endpoint metadata を共有し、Takos capability grant は
API key / OAuth client の access output を共有します。`publish` 自体は resource
creation や backend selection、generic plugin resolver ではなく、deploy pipeline
は grant の validation / env injection と catalog sync だけを行います。

manifest 由来の publication は primitive declaration の projection として
保存されますが、catalog 名は space 内で一意です。route publication は
manifest-managed entry です。Takos capability grant は manifest から作ることも、
`/api/publications/:name` から API-managed grant として作ることもできます。

backend 名は manifest には書きません。backend / adapter の選択は operator-only
runtime configuration で解決されます。SQL / object-store / queue などの resource
type は resource API / runtime binding の対象であり、Takos publisher type
ではありません。

### 7.1 route publication

```yaml
publish:
  - name: search
    type: McpServer
    publisher: web
    path: /mcp
    spec:
      transport: streamable-http
```

required fields:

| field       | required | type   | 説明                             |
| ----------- | -------- | ------ | -------------------------------- |
| `name`      | yes      | string | publication 名                   |
| `publisher` | yes      | string | 対応する route の compute target |
| `type`      | yes      | string | custom route publication type    |
| `path`      | yes      | string | 対応する route path              |

optional route metadata:

- `title`
- `spec`

route publication の `type` は custom string です。`McpServer` / `UiSurface`
などの custom type では core は `spec` を opaque object として保存し、platform /
app が解釈します。`FileHandler` だけは platform contract として core parser が
検証します。`FileHandler` の `path` は `:id` segment を含む必要があり、`spec` は
`mimeTypes` / `extensions` の少なくとも一方だけを持てます。

`publisher + path` は `routes[]` の 1 件に一致する必要があります。同じ path を
publisher で分ける場合も、publication は `publisher` で対象 route を明示します。
manifest 全体で同じ `publisher + path` が複数件に一致する状態は invalid です。
route publication の output `url` は assigned hostname と宣言した `path`
から生成されます。`/files/:id` のような path template は許可され、output の
`url` も template URL として consumer に渡ります。

route publication は manifest-managed entry です。`/api/publications/:name` から
MCP / FileHandler / UiSurface などの route publication を直接作る運用は
推奨しません。

### 7.2 Takos capability grant

```yaml
publish:
  - name: takos-api
    publisher: takos
    type: api-key
    spec:
      scopes:
        - files:read
```

| field       | required | type   | 説明                 |
| ----------- | -------- | ------ | -------------------- |
| `name`      | yes      | string | publication 名       |
| `publisher` | yes      | string | `takos`              |
| `type`      | yes      | string | Takos publisher type |
| `spec`      | yes      | object | type-specific spec   |

capability grant の output は `consume.env` で alias できます。alias を省略した
output は default env 名を使います。

### 7.3 Takos publisher types

`publish[].publisher/type` は strict です。以下の Takos publisher type
だけを受け付け、未知の type は deploy validation で invalid です。`api-key` /
`oauth-client` は Takos capability grant です。

| type           | required spec fields     | outputs                              |
| -------------- | ------------------------ | ------------------------------------ |
| `api-key`      | `scopes`                 | `endpoint`, `apiKey`                 |
| `oauth-client` | `redirectUris`, `scopes` | `clientId`, `clientSecret`, `issuer` |

`redirectUris` は HTTPS が基本ですが、local development では `localhost`,
`127.0.0.1`, `[::1]`, `.localhost` の HTTP URI も受け付けます。`clientName` と
`metadata.*` は optional です。`metadata` 配下は `logoUri` / `tosUri` /
`policyUri` を受け付けます。

## 8. env

```yaml
env:
  NODE_ENV: production
  LOG_LEVEL: info
```

publication outputs と local env が衝突すると deploy / settings update
は失敗します。衝突判定は uppercase 正規化後に行われ、top-level `env`、
`compute.<name>.env`、同一 compute の consumed publication outputs
のいずれかが同じ env 名に解決されると invalid です。

## 9. overrides

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
