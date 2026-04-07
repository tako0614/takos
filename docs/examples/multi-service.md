# マルチサービス構成

```yaml
name: full-stack-app

compute:
  api:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-api
        artifact: api
        artifactPath: dist/api.js
    depends: [jobs]
  jobs:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-jobs
        artifact: jobs
        artifactPath: dist/jobs.js
    triggers:
      queues:
        - storage: jobs
          batchSize: 10
          maxRetries: 3

storage:
  main-db:
    type: sql
    bind: DB
  uploads:
    type: object-store
    bind: UPLOADS
  jobs:
    type: queue
    bind: JOB_QUEUE
  events:
    type: analytics-engine
    bind: ANALYTICS
```
