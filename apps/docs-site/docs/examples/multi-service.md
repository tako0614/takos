# マルチサービス構成

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: full-stack-app
spec:
  version: 1.0.0
  workers:
    api:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-api
          artifact: api
          artifactPath: dist/api.js
      bindings:
        d1: [main-db]
        r2: [uploads]
        analyticsEngine: [events]
    jobs:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-jobs
          artifact: jobs
          artifactPath: dist/jobs.js
      bindings:
        d1: [main-db]
        queues: [jobs]
      triggers:
        queues:
          - queue: jobs
            export: queue
  resources:
    main-db:
      type: d1
      binding: DB
    uploads:
      type: r2
      binding: UPLOADS
    jobs:
      type: queue
      binding: JOB_QUEUE
    events:
      type: analyticsEngine
      binding: ANALYTICS
      analyticsEngine:
        dataset: app-events
```
