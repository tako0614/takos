# 環境変数

Takos の deploy contract で component に渡る env / runtime binding は次の
3 系統です。

1. top-level `env`
2. `components.<name>.env` および `components.<name>.contracts.<>.config.env`
3. `bindings[]` で resolve された source output

normative な field 定義は
[マニフェストリファレンス § 5](/reference/manifest-spec#_5-bindings)、
authoring → canonical 写像は
[Authoring Guide](/takos-paas/guides/authoring-guide) を参照。

## 静的 env

```yaml
env:
  NODE_ENV: production

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
          env:
            LOG_LEVEL: debug
```

top-level `env` は全 component に入ります。 `components.<name>.env` と
`components.<name>.contracts.<>.config.env` はその component (または contract
instance) のみに入ります。

## bindings で env を受け取る

`bindings[]` は consumer ↔ source の **明示** edge です (Core invariant 4 /
7)。 publication / resource / secret / provider-output は injection を
含意せず、 binding で明示しない限り env / runtime binding に渡りません。

env 値の向きは **`{ ENV_NAME: outputName }`** (env 慣例と同じ)。 単一 output
の resource binding は `env: ENV_NAME` のスカラで十分です。

```yaml
bindings:
  - from:
      publication: takos.api-key
      request:
        scopes: [files:read]
    to:
      component: web
      env:
        TAKOS_API_ENDPOINT: endpoint
        TAKOS_API_KEY: apiKey
```

env 名は `[A-Za-z_][A-Za-z0-9_]*` に一致する必要があり、 保存時と注入時に
uppercase 正規化されます。

## resource binding

```yaml
resources:
  app-db:
    ref: resource.sql.postgres@v1
  app-cache:
    ref: resource.key-value@v1

bindings:
  - from: { resource: app-db }
    to: { component: web, env: DATABASE_URL }
    access: database-url
  - from: { resource: app-cache }
    to: { component: web, binding: CACHE }
    access: kv-runtime-binding
```

`to.env` は env として、 `to.binding` は runtime binding として渡ります。
`access:` は resource ref が単一 access mode なら省略可、 複数候補を持つ
ref では明示が必要です (Core § 11 ambiguous shorthand)。

## collision rule

deploy 時に次の collision が validated されます:

- 同 component 内で同名 env / binding 名を複数 binding が target にできない
  (binding target collision、 Core § 11)
- top-level `env`、 `components.<>.env`、 `bindings[]` の env target が
  同じ env 名に解決されると invalid (uppercase 正規化後に判定)

```yaml
env:
  DATABASE_URL: sqlite://local

bindings:
  - from: { resource: app-db }
    to: { component: web, env: DATABASE_URL }
    access: database-url
```

この例は `DATABASE_URL` が衝突するため invalid です。

## 子 component / sidecar の env

子 component (旧 attached container) も同じ `env` / `bindings[]` contract で
扱います。 `bindings[].to.component` で対象 component を指定するだけです。

```yaml
components:
  web:
    contracts:
      runtime: { ref: runtime.js-worker@v1, config: { ... } }
      ui: { ref: interface.http@v1 }
  sandbox:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
        config:
          source:
            ref: artifact.oci-image@v1
            config: { image: ghcr.io/org/sandbox@sha256:... }
          port: 8080
          env: { HEADLESS: "true" }
      gateway: { ref: interface.http@v1 }
    depends: [web]
```

## よく使う source output

| source                          | output 一覧                                                      |
| ------------------------------- | ---------------------------------------------------------------- |
| `route` 由来 publication output | `url`                                                            |
| `takos.api-key`                 | `endpoint`, `apiKey`                                             |
| `takos.oauth-client`            | `clientId`, `clientSecret`, `issuer`, `tokenEndpoint`, `userinfoEndpoint` |
| `resource.sql.postgres@v1`      | (`database-url` access mode で `DATABASE_URL` 形式の URL)        |
| `resource.key-value@v1`         | (`kv-runtime-binding` access mode で runtime binding handle)     |
| `resource.secret@v1`            | (`secret-env-binding` access mode で secret value)               |

## 次のステップ

- [マニフェスト](/deploy/manifest) --- author 向け全体ガイド
- [Manifest Reference](/reference/manifest-spec) --- normative field 定義
