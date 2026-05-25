# Worker + DB

> このページでわかること: Worker と PostgreSQL を組み合わせた AppSpec。

`worker` と `postgres` component を同じ `.takosumi.yml` に置き、
`publish.<name>.as` / `listen.<binding>.from` で Worker へ DB connection
を渡します。

Short kind names are operator-profile aliases. The route list in gateway `spec`
belongs to the adopted gateway descriptor's open `spec`. `web.spec.entrypoint`
points to a runtime file already present in the resolved source or prepared
archive.

```yaml
apiVersion: v1
metadata:
  id: example.notes
  name: Notes
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker.ts
    publish:
      http:
        as: http-endpoint
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
      class: small
  public:
    kind: gateway
    listen:
      upstream:
        from: web.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        public:
          protocol: https
          host: notes.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

launcher / health endpoint は gateway descriptor spec と Takos product metadata
で表現します。

ポイント:

- runtime と data store は `components` に並べる
- `db` component が `connection` publication を `publish` し、`web` が
  `db.connection` を `listen` する
- DB の credential / connection string は `listen` declaration から env (`DB_*`)
  に materialize される
- AppSpec には provider-specific secret ref や string interpolation を書かない
- Installation dry-run で create / update される component と推定 cost
  を確認する

関連:

- [AppSpec](https://takosumi.com/docs/reference/app-spec)
- [環境変数](/deploy/environment)
- [Simple Worker](/examples/simple-worker)
