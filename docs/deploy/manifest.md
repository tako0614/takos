# デプロイマニフェスト (`.takosumi/manifest.yml`)

> このページでわかること: `.takosumi/manifest.yml` の書き方と各フィールドの意味。

`.takosumi/` には 2 つのマニフェストがあります。

| file | owner | role |
| --- | --- | --- |
| `.takosumi/app.yml` | takosumi-git / Takosumi Accounts | install metadata、binding、permission、publisher、upgrade policy |
| `.takosumi/manifest.yml` | takosumi-git compiler | compute / storage / route の authoring manifest |

kernel に届くのは compiled Shape manifest だけです。field 定義は
[Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)、
install metadata は
[App YAML Spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
を参照してください。

## 基本原則

- `apiVersion: "1.0"` と `kind: Manifest` は必須
- runtime-bearing unit は `resources[]` の Shape resource として書く
- workflow / build / Git convention は `takosumi-git` が扱う
- install-time binding は `.takosumi/app.yml` に書く
- kernel に届く compiled manifest には concrete value、resource ref、secret ref だけを残す

## Worker

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

`workflowRef` は takosumi-git の authoring extension です。workflow が artifact
digest を出力すると、takosumi-git が `spec.artifact.hash` に書き込み、
`workflowRef` を削除してから kernel に送ります。

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

portable な manifest では digest-pinned image URI を使います。

## Resource Wiring

resource 間の dependency は `${ref:...}` / `${secret-ref:...}` で表現します。

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

入口は Shape spec か `custom-domain@v1` resource に書きます。

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

## Install Bindings

OIDC、database allocation、object storage allocation、domain binding、launch token、
deploy intent は `.takosumi/app.yml` の `bindings:` に宣言します。

```yaml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
```

Accounts / takosumi-git が binding を materialize した後、compiled manifest には
concrete env または secret ref が入ります。

## Apply Flow

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

operator が compiled manifest を直接 apply する場合は explicit path を渡します。

```bash
takosumi deploy ./compiled-manifest.yml --remote "$TAKOSUMI_ENDPOINT"
```

## Next

- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [App YAML Spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
- [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
- [Routes](/deploy/routes)
