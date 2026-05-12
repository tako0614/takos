# Worker + DB

> このページでわかること: Worker と PostgreSQL を組み合わせたサンプル。

`worker@v1` と `database-postgres@v1` を同じマニフェストに置き、Worker から DB を参照する構成です。

```yaml
apiVersion: '1.0'
kind: Manifest
metadata:
  name: notes-app
resources:
  - shape: database-postgres@v1
    name: notes-db
    provider: '@takos/managed-postgres'
    spec:
      version: '16'
      size: small

  - shape: worker@v1
    name: web
    provider: '@takos/cloudflare-workers'
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: '2026-05-09'
      routes:
        - notes.example.com/*
      env:
        DATABASE_URL: ${ref:notes-db.connectionString}
        DATABASE_PASSWORD: ${secret-ref:notes-db.passwordSecretRef}
    workflowRef:
      file: .takosumi/workflows/deploy.yml
      job: bundle
      artifact: web
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git の authoring extension です。workflow が bundle digest を作り、`spec.artifact.hash`
に書き込まれた後、compiled manifest からは `workflowRef` が strip されます。

ポイント:

- `resources[]` の各 entry は `shape` / `name` / `provider` / `spec` を持つ
- database credential は raw output ではなく `${secret-ref:...}` で受け取る
- Worker route は `worker@v1.spec.routes` の provider-interpreted string pattern で表現する
- top-level `bindings[]` は current manifest surface ではない。resource 間の 値渡しは `${ref:...}` / `${secret-ref:...}`
  を使う

関連:

- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [環境変数](/deploy/environment)
- [Simple Worker](/examples/simple-worker)
