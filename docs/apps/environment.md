# 環境変数

Takos の group deploy contract では、compute に入る env は次の 3 系統だけです。

1. top-level `env`
2. `compute.<name>.env`
3. `compute.<name>.consume` が解決した publication outputs

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

`consume.inject.env` は output 名 -> env 名 の explicit inject map です。明示した
output だけが inject 対象になります。全 outputs を default env 名で受け取りたい
場合は `inject.defaults: true` を明示します。Takos API key / OAuth client は
`takos.api-key` / `takos.oauth-client` built-in provider publication として
consume します。SQL / object-store / queue などの resource は publish ではなく
resource API / runtime binding 側で扱います。

canonical ref の対応は
[Consume env injection](/reference/glossary#consume-env-injection) を参照。
docs では `inject.env` を使います。

alias に使う env 名は任意文字列ではなく `[A-Za-z_][A-Za-z0-9_]*` に一致する
必要があります。保存時と注入時には uppercase に正規化されます。

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
        inject:
          env:
            endpoint: TAKOS_API_ENDPOINT
            apiKey: TAKOS_API_KEY
```

この例では `web` に `TAKOS_API_ENDPOINT` と `TAKOS_API_KEY` が入ります。

default env 名を使いたい場合は `inject.defaults: true` を指定します。たとえば
`as: takos-api` の default は `PUBLICATION_TAKOS_API_ENDPOINT` と
`PUBLICATION_TAKOS_API_API_KEY` です。`inject.env` と併用すると、明示 alias が
ある output は alias、その他は default env 名になります。

## collision rule

`consume` が解決した env 名は、既存の local env と衝突できません。衝突した場合は
deploy / settings update が失敗します。衝突判定は uppercase
正規化後に行われます。同じ compute に対して、top-level
`env`、`compute.<name>.env`、consumed publication output
のいずれかが同じ env 名に解決されると invalid です。複数の `consume` が同じ
default env 名または alias に解決される場合も invalid です。

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
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
        inject:
          env:
            endpoint: DATABASE_URL
```

この例は `DATABASE_URL` が衝突するため invalid です。

## Attached container

attached container も通常の `env` と `consume` を持てます。consume した
publication outputs はその attached container にだけ inject されます。

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
        image: ghcr.io/org/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 8080
        env:
          HEADLESS: "true"
```

## よく使う output 名

| output source     | outputs                              |
| ----------------- | ------------------------------------ |
| route publication | `url`                                |
| `api-key`         | `endpoint`, `apiKey`                 |
| `oauth-client`    | `clientId`, `clientSecret`, `issuer` |

## 次のステップ

- [マニフェスト](/apps/manifest)
- [Workers](/apps/workers)
- [Manifest Reference](/reference/manifest-spec)
