# マニフェストリファレンス

## 2 段構造の概観 {#two-tier-overview}

Installable App Model では、`.takosumi/` 配下の manifest を **2 段** に
分離します。

| ファイル                  | 用途                            | 渡し先                         | 仕様 |
| ------------------------- | ------------------------------- | ------------------------------ | ---- |
| `.takosumi/app.yml`       | InstallableApp v1 (installer-bound) | takosumi-git (install UI / binding / permission preview) | [reference/app-yml-spec](/reference/app-yml-spec) |
| `.takosumi/manifest.yml`  | kernel-bound compute manifest   | takosumi kernel (`POST /v1/deployments`) | **本ページ** |

- `.takosumi/app.yml` は **app の identity と install contract** (`apiVersion:
  app.takosumi.dev/v1` / `kind: InstallableApp` / metadata / source / bindings
  / permissions / upgrade) を宣言します。kernel には渡しません。
- `.takosumi/manifest.yml` は **compute resource の宣言** (`resources[]` / shape
  / provider / spec) を宣言します。`bindings.*` / `installation.*` などの
  placeholder は takosumi-git / takosumi-cloud が compile 時に実値へ置換し、
  kernel に渡る最終 manifest は素朴な provider / image / env だけになります。
- 旧 `.takos/app.yml` (deprecated alias, → `.takosumi/manifest.yml`) は legacy
  互換のために本ページの記述も保持していますが、新規 app では `.takosumi/`
  配下に分離してください。

binding 種別 (`identity.oidc@v1` / `database.postgres@v1` /
`object-store.s3-compatible@v1` / `deploy-intent.gitops@v1` /
`install-launch-token@v1` 等) の正本は
[reference/binding-catalog](/reference/binding-catalog) を参照します。

---

`.takosumi/manifest.yml` は Takos の deploy manifest であり、`takosumi` Core の
Deployment への入力 (`Deployment.input.manifest_snapshot`) として canonical
form に展開される public contract です。 旧 `.takos/app.yml` /
`.takos/app.yaml` は **deprecated alias** として後方互換のため受理されますが、
新規 docs / app では `.takosumi/manifest.yml` を current として書きます。

manifest は AppSpec / EnvSpec / PolicySpec の 3 つの input layer を 1
ファイルで表現します (Core
[§ 4](/takosumi/core/01-core-contract-v1.0#_4-appspec-envspec-and-policyspec))。
トップレベル field がそのまま Core の primitive (component / route / resource
/ binding / publication) に対応し、deploy 時には authoring expansion を経て
canonical な component / contract instance form
([Core § 5](/takosumi/core/01-core-contract-v1.0#_5-components-and-named-contract-instances))
に展開されます。 expansion descriptor digest は
`Deployment.resolution.descriptor_closure` に記録されます。

manifest 内には `worker` / `service` / `attached container` / `compute` /
`triggers` / `consume` といった旧 authoring 語彙は **存在しません**。 全ての
具体性は `ref: <descriptor-uri-or-alias>` (descriptor 参照) と `config:`
(descriptor schema に従う) で表現されます。Core が知らない domain kind は
manifest 表面にも出ません。

公開 descriptor set は
[Official Descriptor Set v1](/takosumi/descriptors/official-descriptor-set-v1)
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
```

ポイント:

- top-level field は Core 語彙のみ (`components` / `routes` / `resources` /
  `bindings` / `publications` / `environments` / `policy`、 および Phase
  1.4.5 で additive に追加される `namespace` / `services` / `imports` /
  `serviceResolvers`、 詳細は § 14)
- 各 component は `contracts` map で名前付き contract instance を宣言する
- 値の意味は全て `ref: <descriptor>` が決め、`config:` がその schema に従う
- route は exposure を listener / match / transport descriptor に bind する
- 詳細仕様は § 1 以降を参照

## 1. top-level fields

| field          | required | type   | 説明                                                |
| -------------- | -------- | ------ | --------------------------------------------------- |
| `name`         | yes      | string | display 名。deploy / install では既定の group 名にもなる |
| `version`      | no       | string | display 用 version (semver 推奨)                    |
| `namespace`    | no       | string | この deployment が export する namespace。 cross-instance binding で provider 側として動作するときに declare する (例 `takosumi`) |
| `components`   | no       | map    | component declaration map (AppSpec)                 |
| `routes`       | no       | array  | route declaration (AppSpec)                         |
| `resources`    | no       | map    | resource claim map (AppSpec)                        |
| `bindings`     | no       | array  | explicit binding edge (AppSpec)                     |
| `publications` | no       | array  | typed outputs publication catalog (AppSpec)         |
| `services`     | no       | array  | cross-instance service export 宣言。 詳細は § 14 |
| `imports`      | no       | array  | cross-instance service import 宣言。 詳細は § 14 |
| `serviceResolvers` | no   | array  | anchor pin (`imports[]` を持つ deployment は必須)。 詳細は § 14 |
| `environments` | no       | map    | EnvSpec hooks per environment label                 |
| `policy`       | no       | object | PolicySpec hooks                                    |

未知 top-level field は invalid です。custom metadata は対応 descriptor が
許可する `metadata` slot に入れます。

`name` は deploy 時の既定 group 名にもなります。 `--group` で override 可能
です。

## 2. components

`components.<name>` は `app.component:<name>` として ObjectAddress に登場する
canonical declaration です
([Core § 5](/takosumi/core/01-core-contract-v1.0#_5-components-and-named-contract-instances))。
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
              workflow: .takosumi/workflows/deploy.yml
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
([Core § 5](/takosumi/core/01-core-contract-v1.0#_5-components-and-named-contract-instances))。

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
            workflow: .takosumi/workflows/build.yml
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
([Core § 10](/takosumi/core/01-core-contract-v1.0#_10-interface-exposure-route-router-and-publication))。

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
([Core § 12](/takosumi/core/01-core-contract-v1.0#_12-resources-and-resourceinstance))。

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
([Core invariant 5](/takosumi/core/01-core-contract-v1.0#_2-core-invariants))。

## 5. bindings

`bindings[]` は consumer ↔ source の **explicit** edge。
`Deployment.desired.bindings[]`
([Core § 11](/takosumi/core/01-core-contract-v1.0#_11-bindings))
の入力です。

Core invariant 4 / 7 により、publication / resource は injection を含意せず、
binding material は `bindings[]` で明示する必要があります。

> **Invariant 11**: `Deployment.desired` (含む `bindings[]` / `routes[]` /
> `resources[]`) は `Deployment.status` が `applied` になった後 immutable
> です。 binding 構造の変更は新しい `AppRelease` を必要とします
> ([Core § 2 invariant 11](/takosumi/core/01-core-contract-v1.0#_2-core-invariants))。

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

### 5.1 from (4 source kinds + 1 cross-instance kind)

Core § 11 の 4 source kind + cross-instance service binding 用の source
kind (`import`) に対応します。

```yaml
# 1. resource
from: { resource: app-db }

# 2. publication (catalog 名 または built-in provider publication)
from:
  publication: takos.api-key
  request:
    name: My App API key
    scopes: [read, write]

# 3. secret (resource.secret@v1 の short alias)
from: { secret: app-session-secret }

# 4. provider-output (descriptor が許可する場合のみ)
from:
  provider-output:
    component: web
    output: assigned-url

# 5. import (cross-instance service binding)
#    `imports[]` で declare した alias を参照、anchor 経由 resolved descriptor
#    の endpoint roles を env に inject する
from:
  import: account-auth
```

`publication` は同 space catalog 名、または Takos built-in
(`takos.api-key`) を参照します。 `request` は publication descriptor が
定義する request schema に従い、未知 field は invalid です。

OIDC consumer 統合は publication ではなく `identity.oidc@v1` AppBinding
(Takosumi Accounts 経由) を使用します。詳細は
[Binding Catalog](/reference/binding-catalog#_1-identity-oidc-v1) を参照。

`secret` は `resources.<name>` で `ref: resource.secret@v1` を持つ resource
への short alias。`from: { resource: <name> }` と同義です。

`provider-output` は対応 descriptor が `directly injectable` を declaration
で明示している場合だけ許可されます
([Core invariant 6](/takosumi/core/01-core-contract-v1.0#_2-core-invariants))。

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
[Official Descriptor Set v1](/takosumi/descriptors/official-descriptor-set-v1)
を参照。

## 6. publications

`publications[]` は primitive が space-level publication catalog に出す
typed outputs declaration
([Core § 10](/takosumi/core/01-core-contract-v1.0#_10-interface-exposure-route-router-and-publication))。
publication は injection を含意せず、 consumer は
`bindings[].from.publication` で明示的に consume します
([Core invariant 4](/takosumi/core/01-core-contract-v1.0#_2-core-invariants))。

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
([Core § 4](/takosumi/core/01-core-contract-v1.0#_4-appspec-envspec-and-policyspec))。
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
    - match: { source: publication, ref: takos.api-key }
      decision: require-approval
    - match: { source: provider-output }
      decision: deny
```

policy decision precedence は `deny > require-approval > allow`
([Core § 7](/takosumi/core/01-core-contract-v1.0#_7-policy-decisions-and-approvals))。
評価結果は `Deployment.policy_decisions[]` に記録されます。

approval (`takos approve <deployment-id>`) は `require-approval` decision を
満たしますが、`deny` を上書きしません (break-glass policy が明示で許可
する場合を除く)。

## 9. ObjectAddress 規則

manifest field は次の ObjectAddress に対応します
([Core § 9](/takosumi/core/01-core-contract-v1.0#_9-objectaddress)):

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
[`takosumi/core/01-core-contract-v1.0.md`](/takosumi/core/01-core-contract-v1.0)
§ 16 を参照。

## 13. Compile-time placeholders (`.takosumi/manifest.yml`) {#compile-time-placeholders}

> **Cross-ref only**: placeholder resolution order の正本は
> [reference/binding-catalog § 8](/reference/binding-catalog#_8-placeholder-解決順序)
> です。本節は family の概観と例示を提供します。order を変更するときは
> binding-catalog §8 を先に更新してください。

Installable App Model の `.takosumi/manifest.yml` では、kernel が直接解決
**しない** placeholder を `${...}` 構文で埋め込めます。これらは takosumi-git /
takosumi-cloud が install / upgrade 時に実値へ置換し、kernel に渡る最終
manifest からは消えます。kernel 側は素朴な scalar しか見ません。

下表は family を **解決優先度順 (= compile 時に早く解決される順)** に並べた
ものです (binding-catalog §8 と同じ順序):

| placeholder family             | 解決元                                       | 例                                              |
| ------------------------------ | -------------------------------------------- | ----------------------------------------------- |
| `${params.<key>}`              | Install API request の `params`              | `${params.domain}`                              |
| `${installation.<key>}`        | AppInstallation record (`id` / `spaceId` / `appId` / `accountId` 等) | `${installation.id}`                            |
| `${artifacts.<job>.<key>}`     | takosumi-git workflow run の artifact        | `${artifacts.api.image}`                        |
| `${bindings.<name>.<key>}`     | `.takosumi/app.yml` の `bindings.<name>` で declare し AppInstallation の AppBinding が解決した値 | `${bindings.auth.issuerUrl}`                    |
| `${secrets.<name>.<key>}`      | AppBinding の `secretRefs` (vault / KMS)     | `${secrets.auth.clientSecret}`                  |
| `${env.<key>}`                 | runtime 起動時の env (compile 時には残置)    | `${env.LOG_LEVEL}`                              |
| `${refs.<name>.outputs.<key>}` | 同 manifest の他 resource の output (kernel が apply 時に解決) | `${refs.db.outputs.url}`                        |

例 (抜粋、新 spec の `.takosumi/manifest.yml` 形式):

```yaml
apiVersion: "1.0"
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/kubernetes-deployment"
    spec:
      image: "${artifacts.api.image}"
      env:
        DATABASE_URL: "${refs.db.outputs.url}"
        AUTH_DRIVER: "oidc"
        OIDC_ISSUER_URL: "${bindings.auth.issuerUrl}"
        OIDC_CLIENT_ID: "${bindings.auth.clientId}"
        OIDC_CLIENT_SECRET: "${secrets.auth.clientSecret}"
        OIDC_REDIRECT_URI: "${bindings.auth.redirectUri}"
        TAKOS_INSTALLATION_ID: "${installation.id}"
        TAKOS_BASE_URL: "${bindings.domain.url}"
        DEPLOY_INTENT_DRIVER: "${bindings.deploy.driver}"
        DEPLOY_INTENT_REMOTE: "${bindings.deploy.remote}"
        DEPLOY_INTENT_TOKEN: "${secrets.deploy.token}"
        INSTALL_LAUNCH_PUBLIC_KEY: "${bindings.bootstrap.publicKey}"
```

invariants:

- placeholder の名前空間は **kernel に到達してはいけない**。compile 後の最終
  manifest に `${...}` が残っていたら resolution はブロックされます。
- `bindings.<name>` / `secrets.<name>` の `<name>` は `.takosumi/app.yml` の
  `bindings.<name>` 宣言と一致する必要があります (詳細は
  [reference/app-yml-spec](/reference/app-yml-spec) /
  [reference/binding-catalog](/reference/binding-catalog))。
- `secrets.*` を含む env は runtime injection のみで、build log には出しません
  (sandbox boundary, see new.md §22.4)。
- `installation.*` は AppInstallation 台帳 (see
  [architecture/app-installation](/architecture/app-installation)) から
  解決されます。

`.takosumi/app.yml` 側 (installer-bound) の binding declaration / install /
permission / upgrade の正本は
[reference/app-yml-spec](/reference/app-yml-spec) を参照してください。

## 14. Cross-instance imports {#cross-instance-imports}

> **Implementation status**: 本節の `namespace` / `services` / `imports` /
> `serviceResolvers` field と `bindings[].from.import` source kind は additive
> manifest surface として mainline に入っています。現在実装済みなのは
> schema validation、consumer-side anchor resolution、signature verify、
> descriptor pinning、`service-import` binding source identity です。
> provider-side publish automation、cached refresh / revoke、app-level
> placeholder materialization は takosumi-cloud / takosumi-git 側の継続 work
> です。設計の正本は
> [architecture/cross-instance-service-binding](/architecture/cross-instance-service-binding)、
> binding kind の formal spec は
> [reference/binding-catalog § 7](/reference/binding-catalog#_7-service-import-v1)、
> service identifier formal spec は
> [reference/service-identifier-spec](/reference/service-identifier-spec) を
> 参照。

外部 takosumi instance (別 deployment / 別 operator / 別 cloud) の service へ
**forward 3-level dotted service identifier** (`<ecosystem>.<area>.<function>@<ver>`、
例 `takosumi.account.auth@v1`) を介して接続するための manifest field 群です。

設計の核は **「consumer manifest には service identifier のみを記述し、
endpoint URL を書かない」**: hostname dependency は `serviceResolvers[].url`
1 箇所に集中します。

### 14.1 namespace (provider 側)

```yaml
namespace: takosumi
```

この deployment が cross-instance service として export する namespace を
declare します。 `services[]` の各 service id の `<ecosystem>` 部分と
prefix が一致する必要があります (例 `namespace: takosumi` なら `services[].id`
は `takosumi.*.*` のみ valid)。

`services[]` を持たない deployment は `namespace` を省略可。

### 14.2 services[] (provider 側 export)

```yaml
namespace: takosumi
services:
  - id: takosumi.account.auth          # forward 3-level dotted
    version: v1
    contract: takosumi.account.auth@v1
    endpoints:
      - role: oidc-issuer
        url: ${refs.account-auth.outputs.url}
        path: /
      - role: install-launch
        url: ${refs.account-auth.outputs.url}
        path: /v1/install/launch
    metadata:
      pairwiseSubjectMode: true
    publish:
      anchors:
        - https://anchor.example.com/v1/services/
      signing:
        privateKeyRef: ${secrets.providerKey}
```

| field             | required | type   | 説明                                                                |
| ----------------- | -------- | ------ | ------------------------------------------------------------------- |
| `id`              | yes      | string | forward 3-level dotted (version 抜き)。例 `takosumi.account.auth`   |
| `version`         | yes      | string | semver-lite (`v1` / `v2-beta` 等)                                  |
| `contract`        | yes      | string | `<id>@<version>`                                                    |
| `endpoints[]`     | yes      | array  | endpoint role list (provider deploy 時に operator URL で resolve)   |
| `metadata`        | no       | object | service-specific capability flag                                    |
| `publish.anchors` | yes      | array  | provider-signed `ServiceDescriptor` を publish する anchor URL list |
| `publish.signing.privateKeyRef` | yes | vault-uri | descriptor 署名鍵 (Ed25519 推奨)                          |

`endpoints[].url` は manifest placeholder (`${refs.<resource>.outputs.url}`)
で operator-chosen URL に resolve されます。 hostname を直接書かない pattern が
推奨です (operator が任意の hostname で deploy 可能にするため)。

### 14.3 imports[] (consumer 側 import)

```yaml
imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
    refreshPolicy:
      kind: ttl
      ttl: 300s
```

| field           | required | type   | 説明                                                          |
| --------------- | -------- | ------ | ------------------------------------------------------------- |
| `alias`         | yes      | string | manifest 内 alias (`bindings[].from.import` で参照)           |
| `service`       | yes      | string | service identifier (`<id>@<version>`)                         |
| `refreshPolicy` | no       | object | `{ kind: "ttl", ttl: "300s" }` / `{ kind: "event-driven" }` 等 |

consumer manifest には **endpoint URL を書きません**。 service identifier
だけで anchor 経由 resolve されます。

### 14.4 serviceResolvers[] (consumer 側 anchor pin)

```yaml
serviceResolvers:
  - kind: anchor
    url: https://my-anchor.example.com/v1/services/
    publicKey: ${secrets.anchor-publickey}
```

| field       | required | type      | 説明                                                       |
| ----------- | -------- | --------- | ---------------------------------------------------------- |
| `kind`      | yes      | const     | `"anchor"`                                                  |
| `url`       | yes      | string    | anchor service の base URL                                 |
| `publicKey` | yes      | string    | anchor の signed-descriptor verify 用 public key (PEM 等) |

`imports[]` を持つ deployment は `serviceResolvers[]` を 1 個以上必須。
複数 anchor を pin した場合 fallback として順次試行されます (ROADMAP R-38
mitigation)。

### 14.5 binding 連携 (`bindings[].from.import`)

`imports[]` で declare した alias は `bindings[].from.import` で参照されます:

```yaml
bindings:
  - from:
      import: account-auth         # imports[].alias を参照
    to:
      component: web
      env:
        OIDC_ISSUER_URL: endpoints.oidc-issuer.url
        OIDC_INSTALL_LAUNCH_URL: endpoints.install-launch.url
        OIDC_JWKS_URL: endpoints.jwks.url
```

`to.env` の値 (`endpoints.oidc-issuer.url` 等) は resolved descriptor の
`endpoints[].role` を辿ります。 詳細は
[binding-catalog § 7.4](/reference/binding-catalog#_7-4-output-placeholders)
を参照。

### 14.6 Resolution flow と invariants

kernel apply 時の処理:

1. `imports[]` を走査
2. `serviceResolvers[]` の anchor URL に GET `/v1/services/<service-id>@<version>`
3. anchor が provider-signed `ServiceDescriptor` を返す
4. kernel が:
   - signature verify (anchor pinned `publicKey` で、 invariant 16)
   - contract version match (manifest `@v1` ≠ descriptor version は reject)
   - descriptor digest / provider instance / expiry を resource metadata に pin
     (invariant 17 の consumer-side foundation)
   - `CrossInstanceShare` resolution evidence を作成
5. `bindings[].from.import` は `endpointRole` / `field` と合わせて
   `service-import:<alias>/<role>/<field>` として source identity を保つ
6. `${imports.<alias>.endpoints.<role>.url}` / `${bindings.<name>...}` の実
   placeholder materialization は installer / account-plane integration で行う

詳細は
[architecture/cross-instance-service-binding § 3](/architecture/cross-instance-service-binding#_3-resolution-flow-kernel-apply-時)
と
[Core contract v1.0 invariants](/takosumi/core/01-core-contract-v1.0#_2-core-invariants)
を参照。
