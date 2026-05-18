# Worker + DB

> このページでわかること: Worker と PostgreSQL を組み合わせた AppSpec。

`worker` と `postgres` component を同じ `.takosumi.yml` に置き、`use:` edge で
Worker へ DB connection を渡します。

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
    routes:
      - notes.example.com/*
    use:
      db:
        env: DATABASE_URL
  db:
    kind: postgres
    spec:
      class: small
interfaces:
  launch:
    target: web
    path: /
  health:
    target: web
    path: /healthz
```

ポイント:

- runtime と data store は `components` に並べる
- DB の credential / connection string は `use:` edge から env に materialize される
- AppSpec には provider-specific secret ref や string interpolation を書かない
- Installation dry-run で create / update される component と推定 cost を確認する

関連:

- [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [環境変数](/deploy/environment)
- [Simple Worker](/examples/simple-worker)
