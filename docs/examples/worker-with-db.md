# Worker + DB

> このページでわかること: Worker と PostgreSQL を組み合わせた AppSpec。

> **Wave N planned (2026-05-21 RFC stage)**: 本サンプルが使う `build:` field と
> curated 4 kind (= worker / postgres / object-store / custom-domain) は
> takosumi Wave N で削除予定 (= kernel pure contract executor 化、 build は
> 別 `kind: build` component に移管、 specific kind は operator distribution
> が JSON-LD + plugin で持ち込む)。 詳細 design は takosumi
> [RFC 0001](https://takosumi.com/docs/rfc/0001-kernel-kind-agnostic) を参照。
> 現状のサンプルは引き続き動作します。

`worker` と `postgres` component を同じ `.takosumi.yml` に置き、 namespace pub/sub
(`publish` / `listen`) で Worker へ DB connection を渡します。

```yaml
apiVersion: v1
metadata:
  id: example.notes
  name: Notes
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    spec:
      routes:
        - notes.example.com/*
    listen:
      example.notes.db:
        as: env
        prefix: DB_
  db:
    kind: postgres
    publish:
      - example.notes.db
    spec:
      class: small
```

> launcher / health endpoint は worker materializer convention (= `spec.routes`
> の HTTP path) で表現します (= Wave J で top-level `interfaces:` は AppSpec
> から物理削除済)。

ポイント:

- runtime と data store は `components` に並べる
- `db` component が `example.notes.db` namespace を `publish` し、 `web` が `listen` する
- DB の credential / connection string は `listen` declaration から env (`DB_*`) に materialize される
- AppSpec には provider-specific secret ref や string interpolation を書かない
- Installation dry-run で create / update される component と推定 cost を確認する

関連:

- [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [環境変数](/deploy/environment)
- [Simple Worker](/examples/simple-worker)
