# 環境変数

Takos の runtime env は current `.takosumi/manifest.yml` の `resources[]` にある
`spec.env` から渡します。kernel に届く compiled manifest の正本 envelope は
`apiVersion: "1.0"` / `kind: Manifest` / `resources[]` であり、旧 `components` /
top-level `bindings[]` / `publications[]` AppSpec form は現行 surface
ではありません。

env の入力元は 3 種類です。

1. author が manifest に直接書く static value
2. resource output 参照 (`${ref:...}` / `${secret-ref:...}`)
3. installer / account plane が materialize した concrete value または secret
   ref

`${bindings.*}` / `${secrets.*}` / `${installation.*}` / `${params.*}` /
`${artifacts.*}` / `${imports.*}` / legacy `${refs.*}` は installer-only または
removed placeholder です。 current `takosumi-git install apply` は Accounts
materialization 後の deploy request build でも unresolved のまま残る manifest を
kernel request の前に reject します。

normative な field 定義は
[Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)、install-time
binding の出力は
[Binding Catalog](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/binding-catalog.md)
を参照してください。

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

`.takosumi/app.yml` の AppBinding は installer-bound です。binding catalog の
`${bindings.*}` / `${secrets.*}` / `${installation.*}` syntax は authoring-time
reserved syntax ですが、current `takosumi-git` compiler は unresolved
placeholder を materialize したふりで kernel に渡しません。binding materializer
が concrete value または secret ref を提供した compiled manifest だけが
`POST /v1/deployments` に進めます。

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
# compiled manifest excerpt after binding materialization
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
        DATABASE_URL: postgres://takos:password@db.example.com:5432/takos
        BLOB_ENDPOINT: https://objects.example.com
        BLOB_BUCKET: takos-inst-abc
        BLOB_ACCESS_KEY: takos-inst-abc
        BLOB_SECRET_KEY: resolved-blob-secret
        INSTALL_LAUNCH_PUBLIC_KEY: "-----BEGIN PUBLIC KEY-----..."
        INSTALL_LAUNCH_AUDIENCE: takos.docs
        TAKOS_INSTALLATION_ID: inst_abc
```

## Namespace Export Env

Takosumi Accounts などの operator-owned dependency は namespace export と
account API / OIDC discovery / BillingPort で扱います。`operator.identity.oidc`
から materialize された issuer URL や OIDC client は、compiled manifest では
concrete env または secret ref として表れます。kernel は `imports[]` /
`serviceResolvers[]` / signed `ServiceDescriptor` を解決しません。

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

| env                         | 由来例                                                             | 説明                         |
| --------------------------- | ------------------------------------------------------------------ | ---------------------------- |
| `AUTH_DRIVER`               | static `oidc`                                                      | OIDC consumer mode           |
| `OIDC_ISSUER_URL`           | AppBinding / namespace export materialization                      | operator-resolved issuer URL |
| `OIDC_CLIENT_ID`            | materialized AppBinding value                                      | OIDC client id               |
| `OIDC_CLIENT_SECRET`        | `${secret-ref:oidc-client-secret}` or materialized secret ref      | OIDC client secret           |
| `OIDC_REDIRECT_URI`         | materialized AppBinding value                                      | callback URL                 |
| `DATABASE_URL`              | `${ref:db.connectionString}` / `${secret-ref:db.connectionString}` | Postgres connection URL      |
| `BLOB_ENDPOINT`             | materialized object-store value                                    | Object store endpoint        |
| `BLOB_BUCKET`               | materialized object-store value                                    | Object store bucket          |
| `BLOB_ACCESS_KEY`           | materialized object-store value                                    | Object store access key      |
| `BLOB_SECRET_KEY`           | materialized secret ref                                            | Object store secret key      |
| `BASE_URL`                  | concrete URL or `${ref:api.url}`                                   | Takos public origin          |
| `TAKOS_INSTALLATION_ID`     | concrete AppInstallation id                                        | AppInstallation id           |
| `INSTALL_LAUNCH_PUBLIC_KEY` | materialized launch-token public key                               | launch token verification    |
| `INSTALL_LAUNCH_AUDIENCE`   | materialized launch-token audience                                 | launch token audience        |
| `DEPLOY_INTENT_DRIVER`      | concrete `gitops`                                                  | deploy intent driver         |
| `DEPLOY_INTENT_REMOTE`      | materialized deploy remote                                         | deploy intent remote         |
| `DEPLOY_INTENT_TOKEN`       | materialized secret ref                                            | deploy intent token          |

`TAKOS_BASE_URL` は `BASE_URL` の compatibility alias として受け取る場合がありま
す。新規 manifest では `BASE_URL` を使います。

## 次のステップ

- [マニフェスト](/deploy/manifest) --- author 向け全体ガイド
- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
  --- compiled manifest の正本
- [InstallableApp v1 (`.takosumi/app.yml`)](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
  --- binding declaration の正本
- [Binding Catalog](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/binding-catalog.md)
  --- binding output / env injection 一覧
- [OIDC Consumer](/apps/oidc-consumer) --- Takos app 側の OIDC consumer env
