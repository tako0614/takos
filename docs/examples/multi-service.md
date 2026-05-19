# Multi-Service 構成

> このページでわかること: API + background Worker + DB を 1 つの AppSpec にまとめるサンプル。

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: example.full-stack
  name: Full Stack App
components:
  api:
    kind: worker
    build:
      command: npm ci && npm run build:api
      output: dist/api.mjs
    spec:
      routes:
        - api.example.com/*
    listen:
      example.full-stack.db:
        as: env
        prefix: DB_
  jobs:
    kind: worker
    build:
      command: npm ci && npm run build:jobs
      output: dist/jobs.mjs
    listen:
      example.full-stack.db:
        as: env
        prefix: DB_
  db:
    kind: postgres
    publish:
      - example.full-stack.db
    spec:
      class: standard
```

background job を cron で起動したい場合、schedule は AppSpec の current public
surface ではなく、operator / app layer の上位設定として扱います。Takosumi
kernel は workflow / cron / scheduler surface を public concept にしません。

ポイント:

- 複数 workload は `components` に複数 component として並べる
- shared database は 1 つの namespace path (`example.full-stack.db`) を `db` が publish し、
  `api` / `jobs` が同じ namespace を `listen` する
- HTTP entrypoint は worker の `spec.routes` と必要なら `custom-domain` component で表現する

関連:

- [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [環境変数](/deploy/environment)
- [Worker + DB](/examples/worker-with-db)
