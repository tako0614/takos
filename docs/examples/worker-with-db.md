# Worker + DB

```yaml
name: notes-app

publish:
  - name: primary-db
    provider: takos
    kind: sql
    spec:
      resource: notes-db
      permission: write
  - name: assets
    provider: takos
    kind: object-store
    spec:
      resource: notes-assets
      permission: write

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: primary-db
        env:
          endpoint: DATABASE_URL
          apiKey: DATABASE_API_KEY
      - publication: assets
        env:
          endpoint: ASSETS_ENDPOINT
          apiKey: ASSETS_API_KEY

routes:
  - target: web
    path: /
```

この contract では deploy core は DB や object store を直接は解決しません。
app は provider-backed publication の endpoint と credential を env で受け取ります。
