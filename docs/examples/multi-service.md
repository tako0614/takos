# マルチサービス構成

この例は
[Canonical minimal manifest](/reference/manifest-spec#canonical-minimal-manifest)
を複数 compute と `triggers` で拡張したものです。

```yaml
name: full-stack-app

env:
  DATABASE_URL: postgres://example.local/app
  UPLOADS_ENDPOINT: https://uploads.example.local

compute:
  api:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-api
        artifact: api
        artifactPath: dist/api.js

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
```
