# 環境変数

> このページでわかること: AppSpec の namespace pub/sub と Installation materialization で runtime env を渡す方法。

runtime env は operator / provider が Deployment apply 時に materialize します。
アプリ author は `.takosumi.yml` の component dependency を namespace pub/sub
(`publish` / `listen`) で構造的に宣言します。

env の主な入力元:

1. sibling component の `publish` した namespace path を `listen` する (`as: env` / `as: env`+`prefix:`)
2. takosumi-cloud が publish する `operator.identity.oidc` を `listen` する
3. operator account plane が発行する launch / Installation metadata

## DB connection

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: example.notes
  name: Notes
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    listen:
      example.notes.db:
        as: env
        prefix: DB_
  db:
    kind: postgres
    publish:
      - example.notes.db
```

`db` component が publish する namespace path を `web` が `listen` し、 provider が作った
connection string / secret reference が `DB_URL` などとして worker に inject されます。
`prefix:` を省略すれば flat key (e.g. `URL` / `HOST`) で展開されます。

## Object store prefix

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: example.media
  name: Media
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    listen:
      example.media.blob:
        as: env
        prefix: BLOB_
  media:
    kind: object-store
    publish:
      - example.media.blob
```

`listen` の `prefix:` は object store の output を `BLOB_*` env として展開します。

## OIDC consumer

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: example.portal
  name: Portal
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    listen:
      operator.identity.oidc:
        as: env
```

`operator.identity.oidc` namespace を listen すると、 takosumi-cloud (operator account
plane) が per-Installation OIDC client を発行し、 `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
`OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URIS` などを runtime env に注入します。 OIDC
component を AppSpec 側に書く必要はありません (= operator が provider として publish)。

## Collision Rule

同じ component に materialize される env 名は一意でなければなりません。
複数の `listen` entry / operator metadata が同じ env 名を生成する場合は dry-run で
invalid になります。 collision は HTTP `409 Conflict` で報告されます。

## Takos Runtime Env

| env | 由来例 | 説明 |
| --- | --- | --- |
| `TAKOS_INSTALLATION_ID` | Installation metadata | app-local session と audit 用 ID |
| `ACCOUNTS_BASE_URL` | operator account plane | launch token / OIDC issuer の base |
| `INSTALL_LAUNCH_INSTALLATION_ID` | launch materialization | launch token consume 対象 |
| `OIDC_ISSUER_URL` | `listen operator.identity.oidc` | OIDC issuer |
| `OIDC_CLIENT_ID` | `listen operator.identity.oidc` | per-Installation OIDC client ID |
| `OIDC_CLIENT_SECRET` | `listen operator.identity.oidc` | provider secret reference |

## 次に読むページ

- [OIDC consumer](/apps/oidc-consumer)
- [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
