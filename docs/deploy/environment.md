# 環境変数

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: AppSpec の connect/listen と Installation
> materialization で runtime env を渡す方法。

runtime env は operator / provider が Deployment apply 時に materialize
します。アプリ author は `.takosumi.yml` の component dependency を
same-AppSpec `connect` と platform service `listen` で構造的に宣言します。

env の主な入力元:

1. sibling component の `component.output` を `connect.<binding>.output` で受ける
   (`inject: secret-env` / `inject: env` + `prefix:`)。`env` は public/non-secret field
   用、secret refs を含む material は `secret-env` など operator-approved
   projection を使う
2. takosumi-cloud が offer する `identity.primary.oidc` を `listen` する
3. operator account plane (リファレンス実装: Takosumi Accounts) が発行する launch / Installation metadata

## DB connection

```yaml
apiVersion: v1
metadata:
  id: example.notes
  name: Notes
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
  db:
    kind: postgres
```

`db.connection` output を `web` が `connect` し、provider が作った
connection string / secret reference が `DB_URL` などとして worker に inject
されます。 `prefix:` を省略すれば flat key (e.g. `URL` / `HOST`)
で展開されます。

## Object store prefix

```yaml
apiVersion: v1
metadata:
  id: example.media
  name: Media
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
    connect:
      blob:
        output: media.bucket
        inject: secret-env
        prefix: BLOB
  media:
    kind: object-store
```

`connect` の `prefix:` は object store の output を `BLOB_*` env
として展開します。

## OIDC consumer

```yaml
apiVersion: v1
metadata:
  id: example.portal
  name: Portal
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
    listen:
      oidc:
        path: identity.primary.oidc
        kind: identity.oidc@v1
        inject: secret-env
        prefix: OIDC
        required: true
```

`listen.oidc.path: identity.primary.oidc` を宣言すると、takosumi-cloud (operator account
plane) が per-Installation OIDC client を発行します。`OIDC_ISSUER_URL` /
`OIDC_CLIENT_ID` / `OIDC_REDIRECT_URI` は grant から materialize される
non-secret runtime config です。 `OIDC_CLIENT_SECRET` は `secretRef` /
`secret-env` 経由で注入されます。Deployment outputs や export bundle には
non-secret config または refs だけを含め、raw secret value は入れません。

## Collision Rule

同じ component に materialize される env 名は一意でなければなりません。複数の
`listen` entry / operator metadata が同じ env 名を生成する場合は dry-run で
invalid になります。collision は `400 invalid_argument` で報告されます。

## Takos Runtime Env

| env                              | 由来例                 | 説明                               |
| -------------------------------- | ---------------------- | ---------------------------------- |
| `TAKOS_INSTALLATION_ID`          | Installation metadata  | app-local session と audit 用 ID   |
| `ACCOUNTS_BASE_URL`              | operator account plane | launch token / OIDC issuer の base |
| `INSTALL_LAUNCH_INSTALLATION_ID` | launch materialization | launch token consume 対象          |
| `OIDC_ISSUER_URL`                | `listen.oidc.path`     | OIDC issuer                        |
| `OIDC_CLIENT_ID`                 | `listen.oidc.path`     | per-Installation OIDC client ID    |
| `OIDC_CLIENT_SECRET`             | `listen.oidc.path`     | provider secret reference          |

## 次に読むページ

- [OIDC consumer](/apps/oidc-consumer)
- [AppSpec](https://takosumi.com/docs/reference/manifest)
