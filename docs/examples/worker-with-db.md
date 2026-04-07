# Worker + SQL / Object Store

```yaml
name: notes-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

storage:
  primary-db:
    type: sql
    bind: DB
    migrations: .takos/migrations/primary-db/
  assets:
    type: object-store
    bind: ASSETS

routes:
  - path: /
    target: web
```

Cloudflare backend では `sql` は D1 に、`object-store` は R2 に解決されます。互換 backend では Takos runtime が同じ spec を SQL / object storage 相当の実装に解決します。
