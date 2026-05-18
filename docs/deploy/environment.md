# 環境変数

> このページでわかること: AppSpec の `use:` edge と Installation materialization で runtime env を渡す方法。

runtime env は operator / provider が Deployment apply 時に materialize します。
アプリ author は `.takosumi.yml` の component dependency を構造的に宣言します。

env の主な入力元:

1. `components.*.use.<dependency>.env`
2. `components.*.use.<dependency>.envPrefix`
3. OIDC component の `mount: oidc`
4. operator account plane が発行する launch / Installation metadata

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
    use:
      db:
        env: DATABASE_URL
  db:
    kind: postgres
```

`db.env: DATABASE_URL` は、provider が作った connection string / secret reference
を `DATABASE_URL` として worker に注入する宣言です。

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
    use:
      media:
        envPrefix: BLOB_
  media:
    kind: object-store
```

`envPrefix` は object store の output を `BLOB_*` env として展開します。

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
    use:
      auth:
        mount: oidc
  auth:
    kind: oidc
    redirectPaths:
      - /auth/oidc/callback
```

`mount: oidc` が宣言されると、Takosumi Accounts が per-Installation OIDC client を
発行し、`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URIS` などを runtime env に注入します。

## Collision Rule

同じ component に materialize される env 名は一意でなければなりません。
`env` と `envPrefix`、OIDC mount、operator metadata が同じ env 名を生成する場合は
dry-run で invalid になります。

## Takos Runtime Env

| env | 由来例 | 説明 |
| --- | --- | --- |
| `TAKOS_INSTALLATION_ID` | Installation metadata | app-local session と audit 用 ID |
| `ACCOUNTS_BASE_URL` | operator account plane | launch token / OIDC issuer の base |
| `INSTALL_LAUNCH_INSTALLATION_ID` | launch materialization | launch token consume 対象 |
| `OIDC_ISSUER_URL` | `mount: oidc` | OIDC issuer |
| `OIDC_CLIENT_ID` | `mount: oidc` | per-Installation OIDC client ID |
| `OIDC_CLIENT_SECRET` | `mount: oidc` | provider secret reference |

## 次に読むページ

- [OIDC consumer](/apps/oidc-consumer)
- [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
