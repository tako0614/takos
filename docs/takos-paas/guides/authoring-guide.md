# Takos PaaS Public Manifest Authoring Guide

Core は canonical で descriptor-pinned。 Authors は flat な public manifest
(`.takos/app.yml`) を書き、PaaS は Deployment が resolved になる前に
AppSpec / EnvSpec / PolicySpec へ展開します
([Core § 4](../core/01-core-contract-v1.0.md#_4-appspec-envspec-and-policyspec))。

normative な field 定義は [マニフェストリファレンス](/reference/manifest-spec)、
公開 descriptor set は
[Official Descriptor Set v1](/takos-paas/descriptors/official-descriptor-set-v1)
を参照。

## Rule

```text
Authoring form is user-facing.
Canonical form is Deployment-resolution-facing.
```

公開 manifest 上の全ての authoring shorthand は resolution 確定前に
canonical form (component / contract instance + descriptor ref) に展開され、
expansion descriptor digest が
`Deployment.resolution.descriptor_closure` に記録されます (Core § 5)。

manifest parser が field を直接 hard-code 解釈することはありません。 全ての
具体性は descriptor が定義し、expansion descriptor がその展開ルールを
ship します。 これにより:

- `worker` / `service` / `attached container` / `compute` / `triggers` などの
  domain-kind を Core が知らなくても authoring が成立する
- 新しい runtime / interface / resource を ship するときも parser を
  変更する必要がない (descriptor を追加するだけ)
- expansion 結果が必ず `descriptor_closure` に digest pin されるため、
  rollback / repair が決定論的に動く

## JS bundle component (旧 worker shorthand)

Authoring form:

```yaml
name: web-app

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
      ui:
        ref: interface.http@v1

routes:
  - id: ui
    expose: { component: web, contract: ui }
    via:
      ref: route.https@v1
      config: { path: / }
```

Canonical (compiler 出力) は authoring form とほぼ同形です。
expansion descriptor は次の digest を closure に追加します:

```text
authoring.binding-access-default@v1   (route の access default 解決)
artifact.workflow-bundle@v1           (artifact descriptor)
```

`artifact.workflow-bundle@v1.config.workflow` は `.takos/workflows/` 配下
である必要があります。 `entry` は repository-relative path で、絶対パスと
`..` traversal は使えません。

## OCI container component (旧 service shorthand)

Authoring form:

```yaml
name: api-app

components:
  api:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
        config:
          source:
            ref: artifact.oci-image@v1
            config:
              image: ghcr.io/acme/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          port: 8080
          healthCheck: { path: /health }
      api:
        ref: interface.http@v1

routes:
  - id: api
    expose: { component: api, contract: api }
    via:
      ref: route.https@v1
      config: { path: / }
```

`artifact.oci-image@v1.config.image` は 64-hex `sha256` digest の image ref
が必須。 `port` / `healthCheck` の意味は `runtime.oci-container@v1` schema
が定義します。

## 複数 component (旧 attached container) 構成

attached container は **別 component** として宣言します。

Authoring form:

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
      ui:
        ref: interface.http@v1
  sandbox:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
        config:
          source:
            ref: artifact.oci-image@v1
            config:
              image: ghcr.io/acme/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          port: 8080
      gateway:
        ref: interface.http@v1
    depends: [web]
```

`depends` は同一 manifest の component 名を参照します。 子 component を
public route で公開するか、親 component に runtime binding として渡すかは
`routes[]` / `bindings[]` で declarative に書きます。

provider 固有の runtime co-location (例: Cloudflare Container DO で worker
と container を同 isolate に同居させる) は composite expansion で expression
します (§ Composite を参照)。

## Routes

HTTP route:

```yaml
routes:
  - id: ui
    expose: { component: web, contract: ui }
    via:
      ref: route.https@v1
      config:
        path: /
        methods: [GET, POST]
```

`path` は `/` で始まる必要があります。 `methods` を省略すると全 HTTP method
に一致します。 同じ `path` で method が重なる route、 1 contract instance を
複数 path に分ける route は invalid です。 `route.id` は manifest 内で一意
で、publication output から `from: { route: <id> }` で参照されます。

queue / schedule / event:

```yaml
routes:
  - id: delivery-consumer
    expose: { component: web, contract: delivery }
    via:
      ref: route.queue@v1
      config:
        source: delivery-queue
        deadLetter: delivery-dlq
        maxBatchSize: 10
        maxRetries: 3
  - id: hourly-tick
    expose: { component: web, contract: scheduler }
    via:
      ref: route.schedule@v1
      config:
        cron: "0 * * * *"
```

`route.queue@v1.config.source` は manifest の resource 名を参照します。
producer 側 access が必要な場合は別途 `bindings[]` で binding を追加します。

## Binding (4 source kinds)

Core § 11 の 4 source kind に対応します。

```yaml
bindings:
  # 1. resource
  - from: { resource: app-db }
    to: { component: web, env: DATABASE_URL }
    access: database-url

  # 2. publication (catalog または built-in provider)
  - from:
      publication: takos.api-key
      request: { scopes: [files:read, files:write] }
    to:
      component: web
      env:
        TAKOS_API_URL: endpoint
        TAKOS_TOKEN: apiKey

  # 3. secret (resource.secret@v1 への short alias)
  - from: { secret: app-session-secret }
    to: { component: web, env: SESSION_SECRET }

  # 4. provider-output (descriptor が許可する場合のみ)
  - from:
      provider-output:
        component: web
        output: assigned-url
    to: { component: web, env: PUBLIC_URL }
```

### shorthand expansion

| authoring shorthand                  | canonical 展開                                       | expansion descriptor                  |
| ------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| `from: { secret: X }`                | `from: { resource: X }` (X.ref が `resource.secret@v1` のとき) | `authoring.binding-secret-alias@v1` |
| `to: { env: SCALAR }`                | `to: { env: { SCALAR: <descriptor-default-output> } }` | `authoring.binding-env-default@v1` |
| `access` 省略 (単一 access mode)      | `access: <descriptor-default-mode>`                   | `authoring.binding-access-default@v1` |
| `metadata.display.icon` 省略          | route target component の icon hint で fallback       | `authoring.launcher-icon-default@v1`  |

新しい authoring shorthand を ship する場合は、 expansion descriptor を
ship して `descriptor_closure` に digest pin できる形にします。

## Built-in provider publication

Takos が公開する API key / OAuth client は built-in provider publication
として `bindings[].from.publication` で consume します。 `publications[]` に
`publisher: takos` を書く形式は **存在しません**。

```yaml
bindings:
  - from:
      publication: takos.api-key
      request: { scopes: [files:read] }
    to:
      component: web
      env:
        TAKOS_API_URL: endpoint
        TAKOS_TOKEN: apiKey
  - from:
      publication: takos.oauth-client
      request:
        clientName: My App
        redirectUris: [/api/auth/callback]
        scopes: [openid, profile, email]
    to:
      component: web
      env:
        OAUTH_CLIENT_ID: clientId
        OAUTH_CLIENT_SECRET: clientSecret
        OAUTH_ISSUER_URL: issuer
```

各 publication の request schema / output 一覧は
[Official Descriptor Set v1 § Built-in provider publications](/takos-paas/descriptors/official-descriptor-set-v1#built-in-provider-publications)
を参照。

未知の `request` field は invalid です。 default injection (`bindings` を
書かずに env 名 default で全 output を inject) は **ありません** —
全 output を env に渡したい場合も明示してください。

## Publication catalog

`publications[]` は typed outputs を declarative に出すだけで、 consumer
への injection を含意しません (Core invariant 4)。

route-backed publication:

```yaml
routes:
  - id: mcp
    expose: { component: web, contract: mcp }
    via: { ref: route.https@v1, config: { path: /mcp } }

publications:
  - name: web-mcp
    ref: publication.mcp-server@v1
    outputs:
      url: { from: { route: mcp } }
    spec:
      transport: streamable-http
```

launcher entry:

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
使います。 file open handler は `publication.file-handler@v1` です。

## Composite

composite descriptor は 1 component に対する authoring 短縮です。 typical
pattern (例: serverless runtime + Postgres) を 1 expansion descriptor で
ship します。

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

compiler 展開:

```yaml
components:
  api:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config: { workflow: ..., job: ..., artifact: ..., entry: ... }
resources:
  api-db:
    ref: resource.sql.postgres@v1
bindings:
  - from: { resource: api-db }
    to: { component: api, env: DATABASE_URL }
    access: database-url
```

descriptor_closure には次が pin されます:

```text
composite.serverless-with-postgres@v1
authoring.composite-expansion@v1
runtime.js-worker@v1
artifact.workflow-bundle@v1
resource.sql.postgres@v1
```

composite-emitted resource / publication / route は `<component>-<suffix>`
の名前 (上記例: `api-db`) になります。 composite expansion がユーザ宣言の
同名 entry と衝突する場合、 compiler は refuse します (Core § 5)。

composite は 1 runtime + 関連 resource / publication / route を 1
component で束ねるパターン用です。 「複数 publication を 1 macro で詰める」
ような用途には使わず、その場合は canonical な複数 contract instance +
複数 publication として書いてください。

## Environments (EnvSpec hooks)

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
        to: { component: web, binding: CACHE }
    routes:
      - id: ui
        via:
          config: { tls: { mode: strict } }
```

EnvSpec は AppSpec 意味を redefine してはいけません (Core § 4)。
`components.<>.contracts.<>.ref` の変更や `bindings[].from.<kind>` 種別の
変更は invalid です。 envelope-shaped value (`config:` 内 leaf 値、
`env:`、route descriptor config 等) のみ override できます。

merge rule の詳細は [マニフェストリファレンス § 7.1](/reference/manifest-spec#_7-1-merge-rules)
を参照。

## Policy (PolicySpec hooks)

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

decision precedence は `deny > require-approval > allow` (Core § 7)。
`require-approval` decision は `takos approve <deployment-id>` で attach
する `Deployment.approval` で満たします。 `deny` は break-glass policy が
明示で許可する場合を除き上書き不可です。

## Direct deploy

direct deploy commands も authoring convenience です:

```bash
takos deploy image ghcr.io/acme/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --port 8080
```

PaaS は generated manifest (canonical form) と AppSpec / EnvSpec /
PolicySpec を組み立てて通常の Deployment lifecycle (resolve → apply →
GroupHead advance) を通します。 generated manifest には次が含まれます:

```yaml
environments:
  takos.directDeploy:
    generated: true
    inputKind: image
```

image direct deploy は `--port` 未指定時に `port: 8080` を default に
しますが、 通常の `.takos/app.yml` の `runtime.oci-container@v1` component
では `port` を明示する必要があります。

既存 group の `GroupHead` が non-generated manifest 由来の Deployment を
指している場合、 direct deploy は明示 opt-in なしにその group を変更
しません。
