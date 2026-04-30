# Worker + DB

この例は
[Canonical minimal manifest](/reference/manifest-spec#canonical-minimal-manifest)
を top-level `env` で拡張したものです。

```yaml
name: notes-app

env:
  DATABASE_URL: postgres://example.local/notes
  ASSETS_ENDPOINT: https://assets.example.local

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - id: web
    target: web
    path: /
```

この例では DB / object store の接続先を env として渡しています。SQL や
object-store は publish ではなく resource API / runtime binding
側で扱う対象です。
