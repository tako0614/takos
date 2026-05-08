# Takosumi Manifest Authoring Guide

Takosumi kernel の current authoring target は `.takosumi/manifest.yml` の Shape
manifest です。kernel は compiled manifest を explicit path / HTTP payload
として 受け取り、`POST /v1/deployments` で apply します。

この guide は current surface だけを扱います。旧 AppSpec の `components` /
`routes` / `bindings` / `publications`、`runtime.js-worker@v1`、
`artifact.workflow-bundle@v1` は current kernel-bound manifest ではありません。

normative な field 定義は [マニフェストリファレンス](/reference/manifest-spec)
を 参照してください。

## Envelope

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: hello-worker
resources: []
```

top-level field は closed set です。

```text
@context | apiVersion | kind | namespace | metadata | template | services | imports | serviceResolvers | resources
```

unknown top-level field は reject されます。installer-bound の
`.takosumi/app.yml` は kernel に渡しません。

## Worker

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: hello-worker
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:0123456789abcdef
      compatibilityDate: "2026-05-09"
      routes:
        - hello.example.com/*
```

`worker@v1` は JS bundle artifact と edge worker runtime を表す Shape resource
です。HTTP route は `spec.routes` に置き、旧 `routes[]` primitive は使いません。

## Web Service + Postgres

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api
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

resource 間参照は `${ref:...}` と `${secret-ref:...}` だけです。参照は
dependency edge を作り、kernel は topological order で provider apply
を実行します。

## Workflow Artifacts

workflow / git / build は takosumi-git の責務です。`.takosumi/manifest.yml`
authoring では `workflowRef` を併記できますが、kernel に届く前に artifact digest
へ解決され、 `workflowRef` は strip されます。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: docs
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
    workflowRef:
      file: .takosumi/workflows/build.yml
      job: build-worker
      artifact: bundle
      target: spec.artifact.hash
```

compiled manifest では次のようになります。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: docs
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

kernel descriptor set に workflow descriptor を追加しません。workflow path の
validation と artifact resolution は takosumi-git 側で完結します。

## App Bindings

OIDC / database / object store / domain / GitOps deploy intent / launch token は
`.takosumi/app.yml` の AppBinding で宣言します。kernel は AppBinding type を
知りません。

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
    allowedScopes: [openid, email, profile]
```

installer は AppBinding を provision し、compiled manifest の `env` や secret
refs に materialize します。詳細は [Binding Catalog](/reference/binding-catalog)
を参照してください。

## Cross-Instance Imports

他 instance の service を参照する場合は `imports[]` と `serviceResolvers[]` を
使います。hostname を contract として固定しません。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: consumer
imports:
  - alias: accountsAuth
    service: takosumi.account.auth@v1
    from:
      namespace: takosumi-cloud
      name: accounts
serviceResolvers:
  - service: takosumi.account.auth@v1
    anchor: https://accounts.example.com/.well-known/takosumi-service
    publicKey: MCowBQYDK2VwAyEAvrjJjvB3Z5m9dr0S9vpz5vDg3hRWD7gWgW4dSRkYw9A=
resources:
  - shape: web-service@v1
    name: app
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/app@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 2 }
      env:
        OIDC_ISSUER_URL: ${imports.accountsAuth.outputs.issuerUrl}
```

## Validation Rules

主な reject 条件:

- `apiVersion` / `kind` が current literal ではない
- unknown top-level field がある
- resource entry に `shape` / `name` / `provider` / `spec` が欠けている
- kernel-bound manifest に `workflowRef` が残っている
- `components` / `routes` / `bindings` / `publications` が含まれる
- `${bindings.*}` / `${secrets.*}` / `${artifacts.*}` が kernel-bound manifest
  に残る
- `${ref:...}` / `${secret-ref:...}` が存在しない resource output を参照する
- `imports[]` があるのに resolver pin が無い

## Related

- [Manifest Reference](/reference/manifest-spec)
- [Binding Catalog](/reference/binding-catalog)
- [Cross-instance Service Binding](/architecture/cross-instance-service-binding)
- [takosumi-git project convention](/architecture/installer-pipeline)
