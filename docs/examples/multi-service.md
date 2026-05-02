# マルチ component 構成

複数 component と `interface.schedule@v1` + `route.schedule@v1` による
背景 job 起動の例です。

```yaml
name: full-stack-app

components:
  api:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: build-api
              artifact: api
              entry: dist/api.js
      api:
        ref: interface.http@v1
  jobs:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: build-jobs
              artifact: jobs
              entry: dist/jobs.js
      tick:
        ref: interface.schedule@v1
    depends: [api]

resources:
  app-db:
    ref: resource.sql.postgres@v1
  app-uploads:
    ref: resource.object-store.s3@v1

bindings:
  - from: { resource: app-db }
    to: { component: api, env: DATABASE_URL }
    access: database-url
  - from: { resource: app-db }
    to: { component: jobs, env: DATABASE_URL }
    access: database-url
  - from: { resource: app-uploads }
    to: { component: api, binding: UPLOADS }
    access: object-runtime-binding

routes:
  - id: api
    expose: { component: api, contract: api }
    via: { ref: route.https@v1, config: { path: / } }
  - id: jobs-tick
    expose: { component: jobs, contract: tick }
    via:
      ref: route.schedule@v1
      config: { cron: "*/10 * * * *" }
```

ポイント:

- 同じ resource を複数 component に渡したい場合は `bindings[]` に複数
  entry を書く。 各 entry は target component と env / binding 名を独立に
  指定する
- background job は `interface.schedule@v1` contract instance を component
  に持たせ、 `route.schedule@v1` を `via.ref` にした route で起動する
  (旧 `triggers.schedules` は廃止)
- `depends` は同一 manifest の component 名による起動順序の hint
