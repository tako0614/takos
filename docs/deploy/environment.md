# 環境変数

> このページでわかること: マニフェストの `spec.env` で環境変数を渡す 3 つの方法と Takos 固有の env 一覧。

runtime env は compiled manifest の `resources[].spec.env` から渡します。

env の入力元は 3 種類です。

1. author が manifest に直接書く static value
2. resource output 参照 (`${ref:...}` / `${secret-ref:...}`)
3. installer / account plane が materialize した concrete value または secret ref

## Static Env

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

## Resource Outputs

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
store / provider secret reference として扱います。

## Install-Time Bindings

`.takosumi.yml` の use edge は installer-bound です。Accounts と
takosumi-git が binding を materialize した後、compiled manifest には concrete
env または secret ref が入ります。

```yaml
apiVersion: app.takosumi.dev/v1
kind: App
bindings:
  auth:
    type: identity.oidc@v1
    redirectPaths:
      - /auth/oidc/callback
  data:
    type: database.postgres@v1
  blobs:
    type: object-store.s3-compatible@v1
```

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
        AUTH_DRIVER: oidc
        OIDC_ISSUER_URL: https://accounts.example.com
        OIDC_CLIENT_ID: takos_inst_abc
        OIDC_CLIENT_SECRET: ${secret-ref:oidc-client-secret}
        OIDC_REDIRECT_URI: https://takos.example.com/auth/oidc/callback
        DATABASE_URL: ${secret-ref:database-url}
        BLOB_ENDPOINT: https://objects.example.com
        BLOB_BUCKET: takos-inst-abc
        ACCOUNTS_BASE_URL: https://accounts.example.com
        INSTALL_LAUNCH_INSTALLATION_ID: inst_abc
        INSTALL_LAUNCH_REDIRECT_URI: https://takos.example.com/_takosumi/launch
        INSTALL_LAUNCH_CONSUME_PATH: /_takosumi/launch
        TAKOS_INSTALLATION_ID: inst_abc
```

## Collision Rule

同一 resource の `spec.env` 内で同じ env 名を複数 source から生成してはいけません。
compile 後に uppercase 正規化した env 名が衝突する場合も invalid です。

## Takos Runtime Env

| env | 由来例 | 説明 |
| --- | --- | --- |
| `AUTH_DRIVER` | static `oidc` | OIDC consumer mode |
| `OIDC_ISSUER_URL` | use edge materialization | issuer URL |
| `OIDC_CLIENT_ID` | use edge materialization | OIDC client id |
| `OIDC_CLIENT_SECRET` | secret ref | OIDC client secret |
| `OIDC_REDIRECT_URI` | use edge materialization | callback URL |
| `DATABASE_URL` | resource output / secret ref | Postgres connection URL |
| `BLOB_ENDPOINT` | object-store binding | Object store endpoint |
| `BLOB_BUCKET` | object-store binding | Object store bucket |
| `BASE_URL` | concrete URL or `${ref:api.url}` | public origin |
| `TAKOS_INSTALLATION_ID` | Installation id | installation id |
| `ACCOUNTS_BASE_URL` | launch-token binding | Takosumi Accounts service の base URL。`/consume` で opaque launch token を redeem する |
| `INSTALL_LAUNCH_INSTALLATION_ID` | launch-token binding | redeem 時に渡す Installation id (`inst_xxx`) |
| `INSTALL_LAUNCH_REDIRECT_URI` | launch-token binding | Accounts が token 発行時に bind した redirect URI。redeem 時に完全一致比較 |
| `INSTALL_LAUNCH_CONSUME_PATH` | static (default `/_takosumi/launch`) | app 側の consume handler path |

## Next

- [マニフェスト](/deploy/manifest)
- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
- [OIDC Consumer](/apps/oidc-consumer)
