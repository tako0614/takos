# マルチサービス構成

```yaml
name: full-stack-app

publish:
  - name: shared-db
    provider: takos
    kind: sql
    spec:
      resource: app-db
      permission: write
  - name: uploads
    provider: takos
    kind: object-store
    spec:
      resource: app-uploads
      permission: write

compute:
  api:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-api
        artifact: api
        artifactPath: dist/api.js
    consume:
      - publication: shared-db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY
      - publication: uploads
        env:
          endpoint: UPLOADS_ENDPOINT
          apiKey: UPLOADS_API_KEY

  jobs:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-jobs
        artifact: jobs
        artifactPath: dist/jobs.js
    depends:
      - api
    triggers:
      schedules:
        - cron: "*/10 * * * *"
    consume:
      - publication: shared-db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY
```
