# Deploy Manifest (`.takos/app.yml`)

`.takos/app.yml` は Takos の deploy manifest です。 ファイル名に `app` が
残りますが、Store / UI の app catalog ではなく、 `takos-paas` Core の
Deployment への入力 (AppSpec / EnvSpec / PolicySpec) を 1 ファイルで宣言
する **primitive desired declaration** です。

`takos deploy` / `takos install` では manifest の `name` が group 名として
使われ、`--group` を指定した場合は override されます。 作成・更新される
primitive は group inventory に所属し、deployment history / rollback /
uninstall などの group 機能を使えます。`.takos/app.yaml` も受け付けます。

normative な field 定義は [マニフェストリファレンス](/reference/manifest-spec)
を、authoring → canonical 展開の写像は
[Authoring Guide](/takos-paas/guides/authoring-guide)
を参照してください。 公開 descriptor set は
[Official Descriptor Set v1](/takos-paas/descriptors/official-descriptor-set-v1)
にあります。

## 思想

- top-level field は Core 語彙のみ
  (`components` / `routes` / `resources` / `bindings` / `publications` /
  `environments` / `policy`)
- 値の意味は全て `ref: <descriptor-uri-or-alias>` (`runtime.js-worker@v1` /
  `interface.http@v1` / `resource.sql.postgres@v1` 等) と、 descriptor
  schema に従う `config:` で表現する
- Core が知らない domain kind (`worker` / `service` / `attached container` /
  `compute` / `triggers`) は manifest 表面には出ない
- publication は injection を含意せず、 binding は `bindings[]` で **明示**
  する (Core invariant 4 / 7)

## 最小例

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

## Built-in provider publication を consume する例

```yaml
name: notes-app

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
      request:
        scopes: [files:read, files:write]
    to:
      component: web
      env:
        INTERNAL_TAKOS_API_URL: endpoint
        INTERNAL_TAKOS_API_KEY: apiKey
```

## Public publication を出して別 group が consume する例

```yaml
name: search-agent

components:
  agent:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: build-agent
              artifact: agent
              entry: dist/agent.js
      mcp:
        ref: interface.http@v1

routes:
  - id: mcp
    expose: { component: agent, contract: mcp }
    via:
      ref: route.https@v1
      config: { path: /mcp }

publications:
  - name: search
    ref: publication.mcp-server@v1
    outputs:
      url: { from: { route: mcp } }
    spec:
      transport: streamable-http
```

別 group の manifest 側:

```yaml
bindings:
  - from: { publication: search }
    to: { component: web, env: SEARCH_MCP_URL }
```

publication は自動注入されません。 必要な consumer が明示的に
`bindings[].from.publication` で consume します。

## OCI image を使う component (常設 container)

```yaml
components:
  api:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
        config:
          source:
            ref: artifact.oci-image@v1
            config:
              image: ghcr.io/org/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          port: 8080
          healthCheck: { path: /health }
      api:
        ref: interface.http@v1
```

`runtime.oci-container@v1` の config は port / healthCheck / shutdown
behavior などを持ちます (descriptor 側で定義)。 `artifact.oci-image@v1` の
`image` は 64-hex `sha256` digest で pin される必要があります。

## 子 component (旧 attached container) を持つ場合

attached container は **別 component** として宣言し、必要なら親 component
からの runtime binding を `bindings[]` で渡します。

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
              image: ghcr.io/org/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          port: 8080
      gateway:
        ref: interface.http@v1
    depends: [web]

routes:
  - id: ui
    expose: { component: web, contract: ui }
    via: { ref: route.https@v1, config: { path: / } }
```

外部公開する route は `expose` する component の interface contract instance
を target にします。 子 component を route から直接公開せず、 親 component
経由でアクセスする場合は route を親側に書き、子 component の binding を
親に渡します。

provider 固有の同居 runtime (Cloudflare Container DO 等) は composite 展開
で expression します (§ Composite を参照)。

## Queue / Schedule trigger

queue / schedule trigger は **別 contract instance + route** で表現します。

```yaml
components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config: { ... }
      ui:
        ref: interface.http@v1
      delivery:
        ref: interface.queue@v1

resources:
  delivery-queue:
    ref: resource.queue.at-least-once@v1
  delivery-dlq:
    ref: resource.queue.at-least-once@v1

routes:
  - id: ui
    expose: { component: web, contract: ui }
    via: { ref: route.https@v1, config: { path: / } }
  - id: delivery-consumer
    expose: { component: web, contract: delivery }
    via:
      ref: route.queue@v1
      config:
        source: delivery-queue
        deadLetter: delivery-dlq
        maxBatchSize: 10
        maxRetries: 3

bindings:
  - from: { resource: delivery-queue }
    to: { component: web, binding: DELIVERY_QUEUE }
    access: queue-producer
  - from: { resource: delivery-dlq }
    to: { component: web, binding: DELIVERY_DLQ }
    access: queue-producer
```

`route.queue@v1` の `source` は manifest 内の resource 名を参照します
(env 名ではない)。 producer access が必要な場合は `bindings[]` で別途
binding を declaration します。

scheduled trigger は `route.schedule@v1` で同形に書きます。 `interface.schedule@v1`
contract instance を component に持たせ、 route で `cron:` 等の schedule
expression を declaration します。

## Resource binding

```yaml
resources:
  app-db:
    ref: resource.sql.postgres@v1
    config:
      migrations: migrations
  app-cache:
    ref: resource.key-value@v1
  app-secret:
    ref: resource.secret@v1
    config: { generate: true }

bindings:
  - { from: { resource: app-db },     to: { component: web, env: DATABASE_URL }, access: database-url }
  - { from: { resource: app-cache },  to: { component: web, binding: CACHE },    access: kv-runtime-binding }
  - { from: { secret: app-secret },   to: { component: web, env: SESSION_SECRET } }
```

binding の `access:` mode は resource ref が単一 access mode なら省略可
(`resource.key-value@v1` の `kv-runtime-binding`、`resource.secret@v1` の
`secret-env-binding` 等)。 複数 access mode を持つ ref では明示が必要です
(`resource.sql.postgres@v1` は `database-url` / `migration-admin` /
`sql-query-api` を持つ)。

`from: { secret: <name> }` は `from: { resource: <name> }` の short alias
です (resource ref が `resource.secret@v1` の場合のみ)。

## OAuth client (built-in provider publication)

```yaml
bindings:
  - from:
      publication: takos.oauth-client
      request:
        clientName: My App
        redirectUris:
          - /api/auth/callback
          - https://example.com/callback
        scopes: [openid, profile, email]
        metadata:
          logoUri: https://example.com/logo.png
    to:
      component: web
      env:
        OAUTH_CLIENT_ID: clientId
        OAUTH_CLIENT_SECRET: clientSecret
        OAUTH_ISSUER_URL: issuer
        OAUTH_TOKEN_URL: tokenEndpoint
        OAUTH_USERINFO_URL: userinfoEndpoint
```

`redirectUris` は HTTPS 絶対 URL に加えて、 `/api/auth/callback` のような
相対 path も受け付けます。 相対 path は deploy 時に group の auto hostname
へ解決されます。

`takos.api-key` / `takos.oauth-client` の request schema と output 一覧は
[Official Descriptor Set v1](/takos-paas/descriptors/official-descriptor-set-v1)
を参照。

## App launcher

UI 一覧 / launcher に表示したい endpoint は
**`publication.app-launcher@v1`** を使います。

```yaml
publications:
  - name: web-ui
    ref: publication.app-launcher@v1
    outputs:
      url: { from: { route: ui } }
    metadata:
      display:
        title: Notes
        description: Personal notes editor
        icon: /icons/notes.svg
        category: office
        sortOrder: 20
```

`publication.http-endpoint@v1` は launcher metadata schema を持たないため、
launcher として登録したい場合は `publication.app-launcher@v1` を選びます。
icon は HTTPS URL または publisher origin からの root-relative path
(例: `/icons/notes.svg`) を指定します。

## File handler

特定 mime type / 拡張子のファイルを開く handler として登録するには
**`publication.file-handler@v1`** を使います。

```yaml
publications:
  - name: docs-file-handler
    ref: publication.file-handler@v1
    outputs:
      url: { from: { route: file-open } }
    metadata:
      display:
        title: Docs
        description: Open Takos document files
    spec:
      mimeTypes: [application/vnd.takos.docs+json]
      extensions: [.takosdoc]
```

route 側 path は `/files/:id` のような template を許可します。 output URL
も template URL のまま consumer に渡されます。

## Composite (authoring 短縮)

複数 component primitive を典型 pattern としてまとめた authoring 短縮
descriptor が composite です。 expansion 結果は canonical form と
descriptor_closure に必ず記録されます (Core § 5)。

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

公開 composite の一覧は
[Official Descriptor Set v1 § Composite descriptors](/takos-paas/descriptors/official-descriptor-set-v1#composite-descriptors)
を参照。

## environments (env override)

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
```

base manifest と同じ field set が使えます。 merge は deep merge を基本と
し、array は identity key (`routes[].id` / `bindings[]` の
`(component, env|binding)` / `publications[].name`) で keyed merge します。
詳細は [マニフェストリファレンス § 7.1](/reference/manifest-spec#_7-1-merge-rules) を参照。

`takos deploy --env production --space SPACE_ID --group my-app` で
production override が適用されます。

## policy (allow / deny / require-approval)

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

policy decision は `Deployment.policy_decisions[]` に記録され、
precedence は `deny > require-approval > allow` (Core § 7)。

## deploy

```bash
takos deploy --env production --space SPACE_ID --group my-app
```

deploy manifest の online deploy source は次で解決されます。

- `runtime.js-worker@v1` の component:
  `artifact.workflow-bundle@v1` の workflow / job / artifact / entry
- `runtime.oci-container@v1` の component:
  `artifact.oci-image@v1` の digest-pinned image

direct deploy (`takos deploy image` 等) は manifest を bypass しません。
PaaS が generated manifest を作成し、`environments.takos.directDeploy.generated:
true` を付けて通常の Deployment lifecycle (resolve → apply → GroupHead
advance) を通します。 既存 group が通常 manifest 由来の Deployment で
管理されている場合、direct deploy は明示 opt-in なしにその group を
変更しません。
