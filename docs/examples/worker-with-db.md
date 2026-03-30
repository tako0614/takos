# Worker + D1 / R2

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: notes-app
spec:
  version: 0.1.0
  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker
      bindings:
        d1: [primary-db]
        r2: [assets]
  resources:
    primary-db:
      type: d1
      binding: DB
      migrations:
        up: .takos/migrations/primary-db/up
        down: .takos/migrations/primary-db/down
    assets:
      type: r2
      binding: ASSETS
  routes:
    - name: app
      target: web
      path: /
```

Cloudflare では通常そのまま `D1` / `R2` に解決されます。他 provider では translation layer が対応する SQL / object storage 実装に変換します。
