# 環境変数

Takos の app deploy contract では、compute に入る env は次の 3 系統だけです。

1. top-level `env`
2. `compute.<name>.env`
3. `compute.<name>.consume` が解決した publication outputs

旧 `storage.bind` / `common-env` / `bindings` の自動注入は廃止されました。

## 基本

```yaml
env:
  NODE_ENV: production

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    env:
      LOG_LEVEL: debug
```

top-level `env` は全 compute に入ります。`compute.<name>.env` はその compute
だけに入ります。

## consume で env を受け取る

provider publication は named outputs を公開し、consumer 側が必要な env 名へ
alias できます。

```yaml
publish:
  - name: primary-db
    provider: takos
    kind: sql
    spec:
      resource: notes-db
      permission: write

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: primary-db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY
```

この例では `web` に `DATABASE_URL` と `DATABASE_API_KEY` が入ります。

alias を省略した場合は provider が持つ default env 名が使われます。たとえば
`primary-db` の default は `PUBLICATION_PRIMARY_DB_ENDPOINT` と
`PUBLICATION_PRIMARY_DB_API_KEY` です。

## collision rule

`consume` が解決した env 名は、既存の local env と衝突できません。衝突した場合は
deploy / settings update が失敗します。

```yaml
env:
  DATABASE_URL: sqlite://local

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: primary-db
        env:
          endpoint: DATABASE_URL
```

この例は `DATABASE_URL` が衝突するため invalid です。

## Attached container

attached container も通常の `env` を持てます。

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    containers:
      sandbox:
        image: ghcr.io/org/sandbox@sha256:def456
        port: 8080
        env:
          HEADLESS: "true"
```

## よく使う output 名

| publication 種別                                                                           | outputs                              |
| ------------------------------------------------------------------------------------------ | ------------------------------------ |
| route publication                                                                          | `url`                                |
| `takos/api`                                                                                | `endpoint`, `apiKey`                 |
| `takos/oauth-client`                                                                       | `clientId`, `clientSecret`, `issuer` |
| `takos/sql` / `object-store` / `key-value` / `queue` / `vector-index` / `analytics-engine` | `endpoint`, `apiKey`                 |

## 次のステップ

- [マニフェスト](/apps/manifest)
- [Workers](/apps/workers)
- [Manifest Reference](/reference/manifest-spec)
