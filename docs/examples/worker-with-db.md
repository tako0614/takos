# Component + DB

`resources[]` で SQL resource を claim し、 `bindings[]` で component に
runtime binding として渡します。

```yaml
name: notes-app

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
      ui:
        ref: interface.http@v1

resources:
  notes-db:
    ref: resource.sql.postgres@v1
    config:
      migrations: migrations
  notes-assets:
    ref: resource.object-store.s3@v1

bindings:
  - from: { resource: notes-db }
    to: { component: web, env: DATABASE_URL }
    access: database-url
  - from: { resource: notes-assets }
    to: { component: web, binding: ASSETS }
    access: object-runtime-binding

routes:
  - id: web
    expose: { component: web, contract: ui }
    via: { ref: route.https@v1, config: { path: / } }
```

ポイント:

- `resources[]` で resource claim を declaration し、 backend は
  `provider-selection` policy gate と operator-only configuration が解決する
  (manifest には provider 名は出ない)
- `bindings[]` で **明示** の binding edge を書く。 `to.env` で env、
  `to.binding` で runtime binding handle として渡る
- `access:` mode は resource ref が単一 access mode なら省略可、 複数候補を
  持つ ref では明示が必要 (`resource.sql.postgres@v1` は `database-url` /
  `migration-admin` / `sql-query-api` を持つので明示)
