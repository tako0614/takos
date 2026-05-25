# Multi-Service 構成

> このページでわかること: API + background Worker + DB を 1 つの AppSpec
> にまとめるサンプル。

Short kind names are operator-profile aliases. The route list in gateway `spec`
belongs to the adopted gateway descriptor's open `spec`. Worker
`spec.entrypoint` values point to runtime files already present in the resolved
source or prepared archive.

```yaml
apiVersion: v1
metadata:
  id: example.full-stack
  name: Full Stack App
components:
  api:
    kind: worker
    spec:
      entrypoint: src/api.ts
    publish:
      http:
        as: http-endpoint
    listen:
      db:
        from: db.connection
        as: secret-env
        prefix: DB
  jobs:
    kind: worker
    spec:
      entrypoint: src/jobs.ts
    listen:
      db:
        from: db.connection
        as: secret-env
        prefix: DB
  db:
    kind: postgres
    publish:
      connection:
        as: service-binding
    spec:
      class: standard
  public:
    kind: gateway
    listen:
      upstream:
        from: api.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        public:
          protocol: https
          host: api.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

background job を cron で起動したい場合、schedule は AppSpec の current public
surface ではなく、operator / app layer の上位設定として扱います。Takosumi kernel
は workflow / cron / scheduler surface を public concept にしません。

ポイント:

- 複数 workload は `components` に複数 component として並べる
- shared database は 1 つの local publication (`db.connection`) を `db` が
  publish し、`api` / `jobs` が同じ publication を `listen` する
- HTTP entrypoint は `gateway` component の listener / gateway descriptor intent で表現する

関連:

- [AppSpec](https://takosumi.com/docs/reference/app-spec)
- [環境変数](/deploy/environment)
- [Worker + DB](/examples/worker-with-db)
