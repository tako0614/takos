# Deploy Manifest (`.takosumi/manifest.yml`)

::: tip 2 段構造になりました
Takos / Takosumi の deploy 入力は **2 つのファイル** に分離されています。

- **`.takosumi/app.yml`** — `kind: InstallableApp` を持つ installer-bound
  descriptor。install UI / binding / permission / publisher metadata の正本で、
  takosumi kernel には渡らず、`takosumi-git` (installer) と `takosumi-cloud`
  が読む。詳細は
  [InstallableApp v1 (`.takosumi/app.yml`)](/reference/app-yml-spec) を参照
- **`.takosumi/manifest.yml`** — kernel-bound compute manifest。binding
  placeholder が compile 時に実値へ解決された結果が takosumi kernel
  (`POST /v1/deployments`) に渡る。**本ページの主題**

旧 `.takos/app.yml` (deprecated) は `.takosumi/manifest.yml` に移行しました。
filename に `app` が残るのは legacy であり、 Store / UI の app catalog では
なく、 takosumi Core の Deployment への入力 (primitive desired declaration)
である点は変わりません。
:::

::: tip Shape Model envelope を使う場合
portable Shape Model の manifest envelope (`resources[]` / `template:` /
`${ref:...}`) は Takosumi リポジトリの
[`docs/manifest.md`](https://github.com/tako0614/takosumi/blob/main/docs/manifest.md)
を参照してください。
このページは Core descriptor (`components` / `contracts` / `routes` /
`bindings` / `publications`) を直接書く canonical 形式の guide です。
:::

`.takosumi/manifest.yml` は Takos の deploy manifest です。 `takosumi` Core の
Deployment への入力 (AppSpec / EnvSpec / PolicySpec) を 1 ファイルで宣言
する **primitive desired declaration** です。

`takos deploy` / `takos install` では manifest の `name` が group 名として
使われ、`--group` を指定した場合は override されます。 作成・更新される
primitive は group inventory に所属し、deployment history / rollback /
uninstall などの group 機能を使えます。`.takosumi/manifest.yaml` も受け付けます。

normative な field 定義は [マニフェストリファレンス](/reference/manifest-spec)
を、authoring → canonical 展開の写像は
[Authoring Guide](/takosumi/guides/authoring-guide)
を参照してください。 公開 descriptor set は
[Official Descriptor Set v1](/takosumi/descriptors/official-descriptor-set-v1)
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
              workflow: .takosumi/workflows/deploy.yml
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
              workflow: .takosumi/workflows/deploy.yml
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

## OIDC consumer (`identity.oidc@v1` AppBinding)

OIDC consumer 統合は publication ではなく `.takosumi/app.yml` の
`bindings.auth: identity.oidc@v1` AppBinding (Takosumi Accounts 経由)
で宣言します。

```yaml
# .takosumi/app.yml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
    allowedScopes: [openid, email, profile]
    subjectMode: pairwise
```

compiled manifest 側では `${bindings.auth.*}` / `${secrets.auth.*}` の
placeholder で env に注入されます。詳細 (request fields / output
placeholders / default env injection) は
[Binding Catalog § identity.oidc@v1](/reference/binding-catalog#_1-identity-oidc-v1)
を参照。

`takos.api-key` の request schema と output 一覧は
[Official Descriptor Set v1](/takosumi/descriptors/official-descriptor-set-v1)
を参照。AppBinding 一覧は [Binding Catalog](/reference/binding-catalog) を参照。

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
            workflow: .takosumi/workflows/build.yml
            job: build
            artifact: bundle
```

公開 composite の一覧は
[Official Descriptor Set v1 § Composite descriptors](/takosumi/descriptors/official-descriptor-set-v1#composite-descriptors)
を参照。

## Shape Model envelope と binding placeholder

`.takosumi/app.yml` で declaration した binding (`identity.oidc@v1` /
`database.postgres@v1` / `object-store.s3-compatible@v1` /
`deploy-intent.gitops@v1` 等) の解決結果は、 manifest 内では
`${bindings.<name>.*}` placeholder として参照します。 同様に、 Shape Model
envelope では `${refs.*}` / `${secrets.*}` / `${artifacts.*}` /
`${installation.*}` / `${params.*}` を組み合わせて compute resource を
expression します。

```yaml
apiVersion: "1.0"

resources:
  - shape: database-postgres@v1
    name: db
    provider: "@takos/managed-postgres"
    spec:
      plan: small

  - shape: object-store@v1
    name: blob
    provider: "@takos/managed-object-store"
    spec:
      plan: standard

  - shape: web-service@v1
    name: api
    provider: "@takos/kubernetes-deployment"
    spec:
      image: "${artifacts.api.image}"
      env:
        DATABASE_URL: "${refs.db.outputs.url}"
        BLOB_ENDPOINT: "${refs.blob.outputs.endpoint}"
        BLOB_ACCESS_KEY: "${refs.blob.outputs.accessKey}"
        BLOB_SECRET_KEY: "${secrets.blob.secretKey}"

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

  - shape: custom-domain@v1
    name: domain
    provider: "@takos/cloudflare-dns"
    spec:
      hostname: "${params.domain}"
      target: "${refs.api.outputs.url}"
```

`${bindings.*}` / `${installation.*}` / `${params.*}` は **takosumi kernel
が解決しません**。 `takosumi-git` (installer) と `takosumi-cloud` が compile
時に実値へ置換し、kernel に渡る最終 manifest はすでにすべての placeholder が
解決済みの素朴な形になります。

```yaml
apiVersion: "1.0"
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/kubernetes-deployment"
    spec:
      image: "ghcr.io/takos/api@sha256:..."
      env:
        DATABASE_URL: "postgres://..."
        AUTH_DRIVER: "oidc"
        # hostname は example。managed install では service identifier + anchor
        # 経由で解決した値を注入する:
        # OIDC_ISSUER_URL: "${imports.account-auth.endpoints.oidc-issuer.url}"
```

### Placeholder の解決順序

| placeholder           | 由来                                                         | 解決者                |
| --------------------- | ------------------------------------------------------------ | --------------------- |
| `${refs.<name>.*}`    | 同 manifest 内の他 resource の output                        | takosumi kernel       |
| `${secrets.<name>.*}` | resource provider が出力した secret                          | takosumi kernel       |
| `${bindings.<name>.*}` | `.takosumi/app.yml` の `bindings.<name>` 解決結果            | takosumi-git          |
| `${artifacts.<name>.*}` | workflow / build pipeline が出力した artifact (image 等) | takosumi-git          |
| `${installation.*}`   | AppInstallation 台帳 (id, accountId, spaceId 等)             | takosumi-git          |
| `${params.<name>}`    | install 時に user が入力した parameter (例: domain)          | takosumi-git          |

binding placeholder の output 一覧と request schema は
[Binding Catalog](/reference/binding-catalog) を参照してください。

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
    - match: { source: publication, ref: takos.api-key }
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
