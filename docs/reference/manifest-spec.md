# マニフェストリファレンス

`.takos/app.yml` は Takos の deploy manifest であり、`takosumi` Core の
Deployment への入力 (`Deployment.input.manifest_snapshot`) として canonical
form に展開される public contract です。`.takos/app.yaml` も受け付けます。

manifest は AppSpec / EnvSpec / PolicySpec の 3 つの input layer を 1
ファイルで表現します (Core
[§ 4](/takos-paas/core/01-core-contract-v1.0#_4-appspec-envspec-and-policyspec))。
トップレベル field がそのまま Core の primitive (component / route / resource
/ binding / publication) に対応し、deploy 時には authoring expansion を経て
canonical な component / contract instance form
([Core § 5](/takos-paas/core/01-core-contract-v1.0#_5-components-and-named-contract-instances))
に展開されます。 expansion descriptor digest は
`Deployment.resolution.descriptor_closure` に記録されます。

manifest 内には `worker` / `service` / `attached container` / `compute` /
`triggers` / `consume` といった旧 authoring 語彙は **存在しません**。 全ての
具体性は `ref: <descriptor-uri-or-alias>` (descriptor 参照) と `config:`
(descriptor schema に従う) で表現されます。Core が知らない domain kind は
manifest 表面にも出ません。

公開 descriptor set は
[Official Descriptor Set v1](/takos-paas/descriptors/official-descriptor-set-v1)
を参照してください。

## 0. Canonical minimal manifest {#canonical-minimal-manifest}

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
```

ポイント:

- top-level field は Core 語彙のみ (`components` / `routes` / `resources` /
  `bindings` / `publications` / `environments` / `policy`)
- 各 component は `contracts` map で名前付き contract instance を宣言する
- 値の意味は全て `ref: <descriptor>` が決め、`config:` がその schema に従う
- route は exposure を listener / match / transport descriptor に bind する
- 詳細仕様は § 1 以降を参照

## 1. top-level fields

| field          | required | type   | 説明                                                |
| -------------- | -------- | ------ | --------------------------------------------------- |
| `name`         | yes      | string | display 名。deploy / install では既定の group 名にもなる |
| `version`      | no       | string | display 用 version (semver 推奨)                    |
| `components`   | no       | map    | component declaration map (AppSpec)                 |
| `routes`       | no       | array  | route declaration (AppSpec)                         |
| `resources`    | no       | map    | resource claim map (AppSpec)                        |
| `bindings`     | no       | array  | explicit binding edge (AppSpec)                     |
| `publications` | no       | array  | typed outputs publication catalog (AppSpec)         |
| `environments` | no       | map    | EnvSpec hooks per environment label                 |
| `policy`       | no       | object | PolicySpec hooks                                    |

未知 top-level field は invalid です。custom metadata は対応 descriptor が
許可する `metadata` slot に入れます。

`name` は deploy 時の既定 group 名にもなります。 `--group` で override 可能
です。

## 2. components

`components.<name>` は `app.component:<name>` として ObjectAddress に登場する
canonical declaration です
([Core § 5](/takos-paas/core/01-core-contract-v1.0#_5-components-and-named-contract-instances))。
各 component は名前付き **contract instance** を `contracts` map で宣言します。

```yaml
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
              job: build-web
              artifact: web
              entry: dist/worker.js
          readiness: /readyz
          env:
            APP_AUTH_REQUIRED: "1"
      ui:
        ref: interface.http@v1
      delivery:
        ref: interface.queue@v1
```

| field       | required | type   | 説明                                              |
| ----------- | -------- | ------ | ------------------------------------------------- |
| `contracts` | one of   | map    | 名前付き contract instance map                    |
| `expand`    | one of   | object | composite descriptor 展開 (§ 2.2)                 |
| `env`       | no       | object | component-local env (全 contract instance に渡る) |
| `depends`   | no       | array  | 同一 manifest の component 名による依存            |

`contracts` か `expand` のどちらか一方が必須です。両方は invalid です。

### 2.1 contracts

`contracts.<instance>` は contract instance の declaration。ObjectAddress は
`app.component:<name>/app.contract:<instance>` です。同じ contract ref を
異なる instance 名で複数回宣言してかまいません
([Core § 5](/takos-paas/core/01-core-contract-v1.0#_5-components-and-named-contract-instances))。

| field    | required | type   | 説明                                              |
| -------- | -------- | ------ | ------------------------------------------------- |
| `ref`    | yes      | string | descriptor canonical URI または authoring alias  |
| `config` | no       | object | descriptor が定義する config schema に従う        |

manifest parser は `ref` の形式チェックと存在チェックだけを行います。`config`
の中身は descriptor digest 解決後に descriptor schema で validate されます。

canonical component は exactly one `revisioned-runtime` lifecycle domain の
root contract instance を持つ必要があります。 違反した component は
resolution がブロックされます (Core § 5)。

### 2.2 expand

```yaml
components:
  api:
    expand:
      ref: composite.serverless-with-postgres@v1
      config:
        source:
          ref: artifact.workflow-bundle@v1
          config:
            workflow: .takos/workflows/build.yml
            job: build
            artifact: bundle
```

composite descriptor は authoring convenience です。compiler が canonical
component / contract instance form に展開し、 expansion descriptor digest
(`authoring.composite-expansion@v1` と composite alias) を
`Deployment.resolution.descriptor_closure` に追加します (Core § 5)。

`expand` を持つ component は `contracts` を同時に持てません。 expansion 後の
追加 contract instance / resource / publication / route が同名で既存
declaration と衝突する場合、resolution はブロックされます。

## 3. routes

`routes[]` は AppSpec の exposure ↔ listener / match / transport binding
declaration。`Deployment.desired.routes[]` の入力です
([Core § 10](/takos-paas/core/01-core-contract-v1.0#_10-interface-exposure-route-router-and-publication))。

```yaml
routes:
  - id: ui
    expose: { component: web, contract: ui }
    via:
      ref: route.https@v1
      config:
        path: /
        methods: [GET, POST]
        timeoutMs: 30000
```

| field    | required | type   | 説明                                                |
| -------- | -------- | ------ | --------------------------------------------------- |
| `id`     | yes      | string | manifest 内一意 (`app.route:<id>` の ObjectAddress) |
| `expose` | yes      | object | exposure target (component + contract instance)     |
| `via`    | yes      | object | route descriptor pin                                |

### 3.1 expose

```yaml
expose:
  component: web      # required, components map の key
  contract: ui        # required, components.<>.contracts の key
```

route の expose target は component の `interface.*` 系 contract instance に
限られます。runtime / artifact contract instance は expose target になりません。
exposure に `exposureEligible=true` を持つ contract descriptor だけが route
target として valid です (Core § 10)。

### 3.2 via

```yaml
via:
  ref: route.https@v1
  config:
    path: /
    methods: [GET, POST]
```

`ref` は route descriptor (官公 set: `route.https@v1` / `route.queue@v1` /
`route.schedule@v1` / `route.event@v1` / `route.tcp@v1` / `route.udp@v1`)。
`config` schema は各 route descriptor 側で定義されます。

### 3.3 validation

route descriptor 別の典型 invariant:

- `route.https@v1`: `path` 必須 (`/` で始まる); `methods` 省略時は全 method;
  同じ `path` で method が重なる route は invalid; 同じ `expose` を別 path に
  分けるのは invalid (1 contract instance につき 1 expose path); CLI と PaaS
  compiler は HTTP/HTTPS route の `target + host + path + methods` 重複を
  検出する
- `route.tcp@v1` / `route.udp@v1`: `port` 必須
- `route.queue@v1` / `route.schedule@v1` / `route.event@v1`: `source` 必須。
  省略時は `route.id` が source 名として使われる

## 4. resources

`resources.<name>` は manifest-managed resource claim。 group inventory と
`Deployment.desired.resources[]`、 durable な `ResourceInstance` lifecycle に
マップされます
([Core § 12](/takos-paas/core/01-core-contract-v1.0#_12-resources-and-resourceinstance))。

```yaml
resources:
  app-db:
    ref: resource.sql.postgres@v1
    config:
      migrations: migrations
  app-secret:
    ref: resource.secret@v1
    config: { generate: true }
```

| field    | required | type   | 説明                                              |
| -------- | -------- | ------ | ------------------------------------------------- |
| `ref`    | yes      | string | resource descriptor (例: `resource.sql.postgres@v1`) |
| `config` | no       | object | descriptor schema に従う config                   |

`config` の意味は descriptor 側責務です。`generate: true` (secret) /
`migrations: <dir>` (sql) のような field は対応 descriptor が定義します。

resource access は `bindings[]` で **明示** に行います (§ 5)。 manifest 内の
`resources.<name>` 自体は env / binding を inject しません
([Core invariant 5](/takos-paas/core/01-core-contract-v1.0#_2-core-invariants))。

## 5. bindings

`bindings[]` は consumer ↔ source の **explicit** edge。
`Deployment.desired.bindings[]`
([Core § 11](/takos-paas/core/01-core-contract-v1.0#_11-bindings))
の入力です。

Core invariant 4 / 7 により、publication / resource は injection を含意せず、
binding material は `bindings[]` で明示する必要があります。

```yaml
bindings:
  - from: { resource: app-db }
    to: { component: web, env: DATABASE_URL }
    access: database-url
```

| field         | required | type   | 説明                                              |
| ------------- | -------- | ------ | ------------------------------------------------- |
| `from`        | yes      | object | binding source (4 種、§ 5.1)                      |
| `to`          | yes      | object | injection target (§ 5.2)                          |
| `access`      | optional | string | source contract が定義する access mode (§ 5.3)    |
| `sensitivity` | optional | string | `public` / `internal` / `secret` / `credential`   |
| `enforcement` | optional | string | `enforced` / `advisory` / `unsupported`           |
| `resolution`  | optional | string | `latest-at-activation` / `pinned-version`         |

### 5.1 from (4 source kinds)

Core § 11 の 4 source kind に対応します。

```yaml
# 1. resource
from: { resource: app-db }

# 2. publication (catalog 名 または built-in provider publication)
from:
  publication: takos.oauth-client
  request:
    clientName: My App
    redirectUris: [/api/auth/callback]
    scopes: [openid, profile]

# 3. secret (resource.secret@v1 の short alias)
from: { secret: app-session-secret }

# 4. provider-output (descriptor が許可する場合のみ)
from:
  provider-output:
    component: web
    output: assigned-url
```

`publication` は同 space catalog 名、または Takos built-in
(`takos.api-key` / `takos.oauth-client`) を参照します。 `request` は
publication descriptor が定義する request schema に従い、未知 field は
invalid です。

`secret` は `resources.<name>` で `ref: resource.secret@v1` を持つ resource
への short alias。`from: { resource: <name> }` と同義です。

`provider-output` は対応 descriptor が `directly injectable` を declaration
で明示している場合だけ許可されます
([Core invariant 6](/takos-paas/core/01-core-contract-v1.0#_2-core-invariants))。

### 5.2 to

```yaml
to:
  component: web
  env: DATABASE_URL          # 単一 output (resource binding)

# OR multi-output (publication に複数 output がある場合)
to:
  component: web
  env:
    OAUTH_CLIENT_ID: clientId
    OAUTH_CLIENT_SECRET: clientSecret
    OAUTH_ISSUER_URL: issuer

# OR runtime-binding (env ではなく runtime binding 名)
to:
  component: web
  binding: DB
```

env / binding 名は `[A-Za-z_][A-Za-z0-9_]*` に一致し、保存時に uppercase に
正規化されます。同 component 内で同じ env / binding 名を複数 binding が
target にすると invalid です (binding target collision, Core § 11)。

env map の向きは **`{ ENV_NAME: outputName }`** (env 慣例と同じ)。 単一
output の resource binding は `env: ENV_NAME` のスカラで十分です。

### 5.3 access

`access` は source contract scope の access mode (Core § 11)。 source ref が
1 access mode しか持たない場合は省略可。 複数候補を持つ ref で省略すると
ambiguous shorthand として resolution がブロックされます。

各 ref の access mode set は
[Official Descriptor Set v1](/takos-paas/descriptors/official-descriptor-set-v1)
を参照。

## 6. publications

`publications[]` は primitive が space-level publication catalog に出す
typed outputs declaration
([Core § 10](/takos-paas/core/01-core-contract-v1.0#_10-interface-exposure-route-router-and-publication))。
publication は injection を含意せず、 consumer は
`bindings[].from.publication` で明示的に consume します
([Core invariant 4](/takos-paas/core/01-core-contract-v1.0#_2-core-invariants))。

```yaml
publications:
  - name: web-mcp
    ref: publication.mcp-server@v1
    outputs:
      url: { from: { route: mcp } }
    spec:
      transport: streamable-http
```

| field      | required | type   | 説明                                              |
| ---------- | -------- | ------ | ------------------------------------------------- |
| `name`     | yes      | string | group-local publication 名                        |
| `ref`      | yes      | string | publication descriptor (例: `publication.mcp-server@v1`) |
| `outputs`  | yes      | map    | output 名 -> source declaration                   |
| `spec`     | no       | object | descriptor が定義する consumer-facing metadata    |
| `metadata` | no       | object | descriptor が定義する authoring metadata          |

`name` は group-local 一意。他 group からは `<group>/<name>` で参照されます。

### 6.1 outputs

```yaml
outputs:
  url:
    from: { route: ui }      # routes[].id を参照
  endpoint:
    from: { value: "https://example.com" }
```

各 output は `from` で値の source を宣言します。 source kind:

- `from: { route: <id> }` — route の assigned URL から導出
- `from: { value: <const> }` — 静的値
- `from: { component: <name>, output: <key> }` — component が公開する
  provider-output

output 名と値型 (`url` / `endpoint` / `secret-ref` / `string` 等) は
publication descriptor が定義します。

### 6.2 metadata

publication descriptor が `metadata` schema を持つ場合のみ書けます。

例: `publication.app-launcher@v1` の launcher metadata:

```yaml
publications:
  - name: web-ui
    ref: publication.app-launcher@v1
    outputs:
      url: { from: { route: ui } }
    metadata:
      display:
        title: My App
        description: Notes editor
        icon: /icons/notes.svg
        category: office
        sortOrder: 20
```

`publication.http-endpoint@v1` は launcher metadata schema を持ちません。
launcher として一覧に出したい endpoint は `publication.app-launcher@v1` を
使います。

## 7. environments

`environments.<env>` は EnvSpec の hooks。 base manifest に対する
environment-specific override を declarative に書きます。

```yaml
environments:
  production:
    components:
      web:
        contracts:
          runtime:
            config:
              env: { LOG_LEVEL: warn }
    bindings:
      - from: { resource: prod-cache }
        to: { component: web, env: CACHE_URL }
    routes:
      - id: ui
        via:
          config: { tls: { mode: strict } }
```

`environments.<env>` で指定できる field は base manifest と同じ
(`components` / `routes` / `resources` / `bindings` / `publications` /
`env`)。

EnvSpec は AppSpec 意味を redefine してはいけません
([Core § 4](/takos-paas/core/01-core-contract-v1.0#_4-appspec-envspec-and-policyspec))。
`components.<>.contracts.<>.ref` の変更や `bindings[].from.<kind>` 種別の
変更は AppSpec の意味変更にあたるため invalid です。

### 7.1 merge rules

全 field 共通で **deep merge** を基本とし、array field は entry の
**identity key** で keyed merge します。

| field          | identity key                              | merge                                                |
| -------------- | ----------------------------------------- | ---------------------------------------------------- |
| `components`   | map key                                   | deep merge per name; merge 後 full validation        |
| `routes`       | `id`                                      | id keyed deep merge; 新 entry は append              |
| `resources`    | map key                                   | deep merge per name                                  |
| `bindings`     | (`to.component`, `to.env` / `to.binding`) | keyed deep merge; 新 entry は append                 |
| `publications` | `name`                                    | deep merge per name                                  |
| `env`          | shallow merge                             | 同名 key は override 側が勝つ                        |

merge 後に全 validation (§ 10) が再実行されます。

base entry を削除したい場合は `<entry>: { $remove: true }` を明示します。
`$remove` 以外の sentinel は使えません。

## 8. policy

PolicySpec hooks。allow / deny / require-approval / defaults を declarative
に書きます。

```yaml
policy:
  defaults:
    bindings:
      sensitivity: internal
      enforcement: enforced
    resolution: latest-at-activation
  rules:
    - match: { source: publication, ref: takos.oauth-client }
      decision: require-approval
    - match: { source: provider-output }
      decision: deny
```

policy decision precedence は `deny > require-approval > allow`
([Core § 7](/takos-paas/core/01-core-contract-v1.0#_7-policy-decisions-and-approvals))。
評価結果は `Deployment.policy_decisions[]` に記録されます。

approval (`takos approve <deployment-id>`) は `require-approval` decision を
満たしますが、`deny` を上書きしません (break-glass policy が明示で許可
する場合を除く)。

## 9. ObjectAddress 規則

manifest field は次の ObjectAddress に対応します
([Core § 9](/takos-paas/core/01-core-contract-v1.0#_9-objectaddress)):

| manifest path                            | ObjectAddress                                  |
| ---------------------------------------- | ---------------------------------------------- |
| `components.<name>`                      | `app.component:<name>`                         |
| `components.<name>.contracts.<instance>` | `app.component:<name>/app.contract:<instance>` |
| `routes[].id`                            | `app.route:<id>`                               |
| `routes[].expose`                        | `app.exposure:<component>:<contract>`          |
| `resources.<name>`                       | `resource.claim:<name>`                        |
| `bindings[]` (synthetic)                 | `app.binding:<component>%2F<env-or-binding>`   |
| `publications[].name`                    | `publication:<group>%2F<name>`                 |

addresses は case-sensitive。 path separator (`/`) を name に含む場合は
percent-encode (`%2F`) します。

## 10. Validation invariants

deploy 前に次の invariant が validated されます:

1. 未知 top-level field は invalid
2. component の `contracts` か `expand` のいずれか必須 (両方は invalid)
3. canonical component には exactly one `revisioned-runtime` root contract
   instance (Core § 5)
4. `routes[].expose.contract` は `interface.*` 系 contract instance のみ
   (`exposureEligible=true` の descriptor)
5. `bindings[].to.component` は components map に存在する必要がある
6. `bindings[].from.<kind>` の参照先が存在する必要がある
7. binding access mode が複数候補のとき `access:` 省略は invalid (Core § 11
   ambiguous shorthand)
8. 同 component 内で同名 env / binding 名を複数 binding が target に
   できない (binding target collision)
9. publication output の `from.route` は `routes[].id` の 1 件に一致
10. `publications[].ref` の descriptor が `metadata` schema を持たない場合、
    `metadata:` 指定は invalid
11. `environments.<env>` の merge 後 manifest が full validation を通る
    必要がある
12. EnvSpec から AppSpec 意味の redefine は invalid (`ref` 変更、`from.<kind>`
    変更等)
13. provider-output binding source は対応 descriptor が directly injectable
    を declaration で許可している場合だけ valid (Core invariant 6)

## 11. Authoring expansion と descriptor closure

公開 manifest convenience は resolution 前に canonical form に展開され、
expansion descriptor digest が `descriptor_closure` に含まれます (Core § 5)。

主な expansion:

- `components.<>.expand` → composite descriptor 展開 (composite alias と
  `authoring.composite-expansion@v1` を closure に追加)
- `bindings[].from.secret` → `from.resource` への alias 展開
  (`authoring.binding-secret-alias@v1`)
- `bindings[].access` 省略 → 単一 access mode の解決
  (`authoring.binding-access-default@v1`)
- 単一 output `to.env: SCALAR` → `to.env: { SCALAR: <default-output> }`
  への展開 (`authoring.binding-env-default@v1`)

これら expansion descriptor は manifest author が直接書く必要は
ありませんが、`descriptor_closure` には必ず記録されます。 expansion 結果は
`takos diff <deployment-id>` で確認できます。

## 12. CLI

```bash
takos deploy <manifest>           # resolve + apply (Heroku-like sugar)
takos deploy --preview            # in-memory preview, no DB record
takos deploy --resolve-only       # resolved Deployment 作成 (apply 待ち)
takos apply <deployment-id>       # resolved Deployment を apply
takos diff <deployment-id>        # resolved expansion + diff vs current GroupHead
takos approve <deployment-id>     # require-approval decision に approval を attach
takos rollback [<group>]          # GroupHead を previous_deployment_id に切替
```

詳細は
[`takosumi/core/01-core-contract-v1.0.md`](/takos-paas/core/01-core-contract-v1.0)
§ 16 を参照。
