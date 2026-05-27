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
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
  jobs:
    kind: worker
    spec:
      entrypoint: src/jobs.ts
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
  db:
    kind: postgres
    spec:
      class: standard
  public:
    kind: gateway
    connect:
      upstream:
        output: api.http
        inject: upstream
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
- shared database は `db.connection` output を `api` / `jobs` が
  `connect` で受け取る
- HTTP entrypoint は `gateway` component の listener / gateway descriptor intent で表現する

関連:

- [AppSpec](https://takosumi.com/docs/reference/manifest)
- [環境変数](/deploy/environment)
- [Worker + DB](/examples/worker-with-db)
