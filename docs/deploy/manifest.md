# Deploy Manifest (`.takosumi/manifest.yml`)

Takos bundled apps / third-party Takosumi installable app repository
は、`.takosumi/` に 2 つの manifest を置きます。

| file                     | owner                            | role                                                                        |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------- |
| `.takosumi/app.yml`      | takosumi-git / Takosumi Accounts | install metadata、binding、permission、publisher、upgrade policy            |
| `.takosumi/manifest.yml` | takosumi-git compiler            | authoring manifest。compile 後は closed Shape manifest だけが kernel に届く |

このページは `.takosumi/manifest.yml` の authoring guide です。正確な field
定義は
[Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)、installer
metadata は
[App YAML Spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
を参照してください。

## 基本原則

- `apiVersion: "1.0"` と `kind: Manifest` は必須。
- compiled manifest の top-level は closed envelope。
- runtime-bearing unit は `resources[]` の Shape resource として書く。
- workflow / build / Git convention は kernel ではなく `takosumi-git` が扱う。
- install-time binding (`identity.oidc@v1` など) は `.takosumi/app.yml` に書く。
- OIDC / billing / dashboard / deploy API は namespace export と account API で
  扱い、kernel manifest には書かない。
- kernel に届く compiled manifest から `workflowRef` と installer-only
  placeholder は消えている必要がある。
- 旧 `components` / `routes[]` / `bindings[]` / `publications[]` AppSpec form は
  current `.takosumi/manifest.yml` ではない。

## 最小 Worker

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: simple-worker
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      routes:
        - simple-worker.example.com/*
    workflowRef:
      file: build.yml
      job: build-worker
      artifact: bundle
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git の private extension です。workflow が
`TAKOSUMI_ARTIFACT=<hash>` を出力すると、takosumi-git がその値を
`spec.artifact.hash` に書き込み、`workflowRef` を削除してから kernel
に送ります。

## Web Service

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        LOG_LEVEL: info
```

`web-service@v1` は OCI image 互換の long-running HTTP service です。`image`
shorthand と `artifact: { kind: oci-image, uri: ... }` は provider が support
する 範囲で使えます。portable な例では digest-pinned image URI
を使ってください。

## Resource Wiring

resource 間の dependency は `${ref:...}` / `${secret-ref:...}` で表現します。
kernel はこれを DAG edge として扱い、cycle を reject します。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api-with-db
resources:
  - shape: database-postgres@v1
    name: db
    provider: "@takos/aws-rds"
    spec:
      version: "16"
      size: small

  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        DATABASE_URL: ${ref:db.connectionString}
        DB_PASSWORD: ${secret-ref:db.passwordSecretRef}
```

## Public Entry Points

top-level `routes[]` はありません。入口は Shape spec か `custom-domain@v1`
resource に書きます。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api-with-domain
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: custom-domain@v1
    name: api-domain
    provider: "@takos/cloudflare-dns"
    spec:
      name: api.example.com
      target: ${ref:api.url}
      certificate:
        kind: auto
```

Worker route patterns are strings in `worker@v1.spec.routes`. See
[Routes](/deploy/routes) for entrypoint patterns.

## Install Bindings

OIDC, database allocation, object storage allocation, domain binding, launch
token, and deploy intent requests are declared in `.takosumi/app.yml`.
AppBinding placeholders (`${bindings.*}` / `${secrets.*}`) are reserved
authoring-time syntax: they must be materialized by the installer / Accounts
integration before the manifest is posted to the kernel. Current
`takosumi-git install apply` resolves supported values after AppInstallation
creation; if installer-only placeholders remain after deploy request build, it
fails before the kernel request.

```yaml
# .takosumi/app.yml (excerpt)
apiVersion: app.takosumi.dev/v1
kind: InstallableApp
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
```

Operator-owned capabilities are resolved outside the kernel manifest. For
example, Takosumi Accounts exposes OIDC through `operator.identity.oidc` and
billing through `operator.billing.default`; takosumi-git / Accounts materialize
the resulting OIDC client, launch token, and billing/reporting grants before the
compiled manifest is submitted.

The manifest sent to the kernel must contain concrete values, provider secret
refs, or kernel resource refs only:

```yaml
# compiled manifest (kernel input excerpt)
apiVersion: "1.0"
kind: Manifest
metadata:
  name: takos
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takos/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: https://accounts.example.com
        OIDC_CLIENT_ID: takos_inst_abc
        OIDC_CLIENT_SECRET: resolved-client-secret
        OIDC_REDIRECT_URI: https://takos.example.com/auth/oidc/callback
```

Raw `${bindings.*}` / `${secrets.*}` / `${imports.*}` placeholders must not
reach the kernel. `services[]`, `imports[]`, and `serviceResolvers[]` are
removed fields and will be rejected by current manifest validation.

## Templates

Templates are optional authoring macros. They expand into normal `resources[]`
before apply.

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: web
template:
  template: web-app-on-cloudflare@v1
  inputs:
    serviceName: web
    image: ghcr.io/example/web@sha256:0123456789abcdef
    port: 8080
    domain: web.example.com
```

Use `template.template: <id>@<version>` in authoring and compiled manifests.
`template.ref` is legacy compatibility only.

## Apply Flow

Local authoring usually goes through takosumi-git:

```bash
takosumi-git push --dry-run
takosumi-git push \
  --endpoint "$TAKOSUMI_ENDPOINT" \
  --token "$TAKOSUMI_TOKEN"
```

For installable apps:

```bash
takosumi-git install preview --cwd . --json
takosumi-git install apply \
  --cwd . \
  --accounts-url "$TAKOSUMI_ACCOUNTS_URL" \
  --account-id "$TAKOSUMI_ACCOUNT_ID" \
  --space-id "$TAKOSUMI_SPACE_ID" \
  --subject "$TAKOSUMI_SUBJECT" \
  --source-commit "$SOURCE_COMMIT" \
  --runtime-base-url "$RUNTIME_BASE_URL" \
  --endpoint "$TAKOSUMI_ENDPOINT" \
  --deploy-token "$TAKOSUMI_DEPLOY_TOKEN"
```

`preview` is non-mutating. `apply` calls Takosumi Accounts to create/update the
AppInstallation ledger, materialize OIDC clients, launch tokens, AppBindings,
and AppGrants, then the installer deploys the compiled manifest to the kernel
and reports completion back to Accounts so Accounts owns the installation status
transition.

## Legacy Note

The old guide documented a descriptor AppSpec with top-level `components`,
`routes`, `bindings`, `publications`, `environments`, and `policy`. That is not
the current `.takosumi/manifest.yml` authoring contract or compiled manifest
contract. Historical migration notes may mention it, but new manifests should
not use it.

Rejected legacy form:

```yaml
name: old-app
components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
routes:
  - id: ui
    expose: { component: web, contract: ui }
```

Current form:

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: new-app
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:0123456789abcdef
      compatibilityDate: "2026-05-09"
```

## Next

- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [App YAML Spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
- [Binding Catalog](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/binding-catalog.md)
- [Routes](/deploy/routes)
- [Simple Worker](/examples/simple-worker)
