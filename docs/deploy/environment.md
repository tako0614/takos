# 環境変数

Takos の runtime env は current `.takosumi/manifest.yml` の `resources[]` にある
`spec.env` から渡します。kernel-bound manifest の正本 envelope は
`apiVersion: "1.0"` / `kind: Manifest` / `resources[]` であり、旧 `components` /
top-level `bindings[]` / `publications[]` AppSpec form は現行 surface
ではありません。

env の入力元は 3 種類です。

1. author が manifest に直接書く static value
2. resource output 参照 (`${ref:...}` / `${secret-ref:...}`)
3. install / service import layer が kernel 到達前または deploy route 内で解決
   する placeholder (`${bindings.*}` / `${secrets.*}` / `${installation.*}` /
   `${imports.*}`)

normative な field 定義は
[Manifest Reference](/reference/manifest-spec)、install-time binding の出力は
[Binding Catalog](/reference/binding-catalog) を参照してください。

## Static Env

`web-service@v1` は `spec.env` で static env を受け取ります。

```yaml
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
        NODE_ENV: production
        LOG_LEVEL: info
```

`worker@v1` は provider がサポートする場合に `spec.env` 相当の provider config
へ materialize されます。route pattern は `worker@v1.spec.routes`、domain は
`web-service@v1.spec.domains` または `custom-domain@v1` で表現します。

## Resource Outputs

resource 間の値渡しは resource output 参照で書きます。credential は raw env
ではなく secret ref を優先します。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: takos
resources:
  - shape: database-postgres@v1
    name: db
    provider: "@takos/managed-postgres"
    spec:
      version: "16"
      size: small

  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takos/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        DATABASE_URL: ${ref:db.connectionString}
        DATABASE_PASSWORD: ${secret-ref:db.passwordSecretRef}
```

`${ref:<resource>.<output>}` は non-secret output、`${secret-ref:...}` は secret
store / provider secret reference として扱います。存在しない resource output を
参照する manifest は reject されます。

## Install-Time Bindings

`.takosumi/app.yml` の AppBinding は installer-bound
です。`.takosumi/manifest.yml` 内では `${bindings.*}` / `${secrets.*}` /
`${installation.*}` を authoring-time placeholder として使えますが、kernel
に直接届く manifest には残しません。 takosumi-git / Takosumi Accounts が
concrete value または secret ref に materialize してから `POST /v1/deployments`
に渡します。

```yaml
# .takosumi/app.yml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp
bindings:
  auth:
    type: identity.oidc@v1
    redirectPaths:
      - /auth/oidc/callback
  data:
    type: database.postgres@v1
  blobs:
    type: object-store.s3-compatible@v1
  bootstrap:
    type: install-launch-token@v1
```

```yaml
# .takosumi/manifest.yml (authoring)
apiVersion: "1.0"
kind: Manifest
metadata:
  name: takos
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ${artifacts.api.image}
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: ${bindings.auth.issuerUrl}
        OIDC_CLIENT_ID: ${bindings.auth.clientId}
        OIDC_CLIENT_SECRET: ${secrets.auth.clientSecret}
        OIDC_REDIRECT_URI: ${bindings.auth.redirectUri}
        DATABASE_URL: ${bindings.data.connectionString}
        BLOB_ENDPOINT: ${bindings.blobs.endpoint}
        BLOB_BUCKET: ${bindings.blobs.bucket}
        BLOB_ACCESS_KEY: ${bindings.blobs.accessKey}
        BLOB_SECRET_KEY: ${secrets.blobs.secretKey}
        INSTALL_LAUNCH_PUBLIC_KEY: ${bindings.bootstrap.publicKey}
        INSTALL_LAUNCH_AUDIENCE: ${bindings.bootstrap.audience}
        TAKOS_INSTALLATION_ID: ${installation.id}
```

## Cross-Instance Service Env

Takosumi Accounts などの外部 service dependency は AppBinding ではなく
`.takosumi/manifest.yml` の `imports[]` / `serviceResolvers[]` で表現します。
consumer manifest は service identifier を参照し、Accounts hostname を直接 pin
しません。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: takos
imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
    refreshPolicy:
      kind: ttl
      ttl: 300s
serviceResolvers:
  - kind: anchor
    url: https://anchor.example.com/v1/services/
    publicKey: BASE64_ED25519_PUBLIC_KEY
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
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
```

`imports[]` がある manifest は `serviceResolvers[]` が必須です。kernel は anchor
から service descriptor を取得し、署名 / version / expiry を検証してから
`${imports.*}` を materialize します。

## Collision Rule

同一 resource の `spec.env` 内で同じ env 名を複数 source から生成してはいけま
せん。compile 後に uppercase 正規化した env 名が衝突する場合も invalid です。

```yaml
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takos/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        DATABASE_URL: sqlite://local
        database_url: ${ref:db.connectionString} # invalid after normalization
```

## Takos Runtime Env

Takos は **OIDC consumer** として動きます。Auth / OIDC issuer / billing は
takosumi kernel ではなく Takosumi Accounts の責務です。kernel は compiled
manifest apply / resource provisioning / routing projection を扱うだけで、 OAuth
issuer endpoint を持ちません。

よく使う env:

| env                         | 由来例                                                               | 説明                         |
| --------------------------- | -------------------------------------------------------------------- | ---------------------------- |
| `AUTH_DRIVER`               | static `oidc`                                                        | OIDC consumer mode           |
| `OIDC_ISSUER_URL`           | `${imports.account-auth.endpoints.oidc-issuer.url}` or AppBinding    | operator-resolved issuer URL |
| `OIDC_CLIENT_ID`            | `${bindings.auth.clientId}`                                          | OIDC client id               |
| `OIDC_CLIENT_SECRET`        | `${secrets.auth.clientSecret}` or `${secret-ref:oidc-client-secret}` | OIDC client secret           |
| `OIDC_REDIRECT_URI`         | `${bindings.auth.redirectUri}`                                       | callback URL                 |
| `DATABASE_URL`              | `${bindings.data.connectionString}` or `${ref:db.connectionString}`  | Postgres connection URL      |
| `BLOB_ENDPOINT`             | `${bindings.blobs.endpoint}`                                         | Object store endpoint        |
| `BLOB_BUCKET`               | `${bindings.blobs.bucket}`                                           | Object store bucket          |
| `BLOB_ACCESS_KEY`           | `${bindings.blobs.accessKey}`                                        | Object store access key      |
| `BLOB_SECRET_KEY`           | `${secrets.blobs.secretKey}`                                         | Object store secret key      |
| `BASE_URL`                  | `${bindings.domain.url}` or `${ref:api.url}`                         | Takos public origin          |
| `TAKOS_INSTALLATION_ID`     | `${installation.id}`                                                 | AppInstallation id           |
| `INSTALL_LAUNCH_PUBLIC_KEY` | `${bindings.bootstrap.publicKey}`                                    | launch token verification    |
| `INSTALL_LAUNCH_AUDIENCE`   | `${bindings.bootstrap.audience}`                                     | launch token audience        |
| `DEPLOY_INTENT_DRIVER`      | `${bindings.deploy.driver}`                                          | deploy intent driver         |
| `DEPLOY_INTENT_REMOTE`      | `${bindings.deploy.remote}`                                          | deploy intent remote         |
| `DEPLOY_INTENT_TOKEN`       | `${secrets.deploy.token}`                                            | deploy intent token          |

`TAKOS_BASE_URL` は `BASE_URL` の compatibility alias として受け取る場合がありま
す。新規 manifest では `BASE_URL` を使います。

## 次のステップ

- [マニフェスト](/deploy/manifest) --- author 向け全体ガイド
- [Manifest Reference](/reference/manifest-spec) --- kernel-bound manifest
  の正本
- [InstallableApp v1 (`.takosumi/app.yml`)](/reference/app-yml-spec) --- binding
  declaration の正本
- [Binding Catalog](/reference/binding-catalog) --- binding output / env
  injection 一覧
- [OIDC Consumer](/apps/oidc-consumer) --- Takos app 側の OIDC consumer env
