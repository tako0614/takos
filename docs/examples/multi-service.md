# Multi-Service 構成

API service、background worker、Postgres を 1 つの current
`.takosumi/manifest.yml` にまとめる例です。kernel-bound manifest は compute /
resource desired state だけを持ち、cron / workflow runner は takosumi-git 側で
扱います。

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: full-stack-app
resources:
  - shape: database-postgres@v1
    name: app-db
    provider: "@takos/managed-postgres"
    spec:
      version: "16"
      size: small

  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: PLACEHOLDER
      port: 8080
      scale: { min: 1, max: 4 }
      domains:
        - api.example.com
      env:
        DATABASE_URL: ${ref:app-db.connectionString}
        DATABASE_PASSWORD: ${secret-ref:app-db.passwordSecretRef}
    workflowRef:
      file: .takosumi/workflows/deploy.yml
      job: build-api
      artifact: api-image
      target: spec.image

  - shape: worker@v1
    name: jobs
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      env:
        DATABASE_URL: ${ref:app-db.connectionString}
        DATABASE_PASSWORD: ${secret-ref:app-db.passwordSecretRef}
    workflowRef:
      file: .takosumi/workflows/deploy.yml
      job: build-jobs
      artifact: jobs-bundle
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git が処理する authoring extension です。kernel に届く
manifest では `api.spec.image` と `jobs.spec.artifact.hash` が concrete digest
になり、`workflowRef` は削除されます。

background job を cron で起動したい場合、schedule は kernel manifest ではなく
takosumi-git の workflow / event layer、または provider plugin の上位設定として
扱います。takosumi kernel は workflow / cron / scheduler surface を持ちません。

ポイント:

- 複数 workload は `resources[]` に複数 resource として並べる
- shared database は `${ref:app-db.connectionString}` と
  `${secret-ref:app-db.passwordSecretRef}` で各 workload に渡す
- HTTP domain は `web-service@v1.spec.domains` か `custom-domain@v1` resource
  で表現する
- top-level `components` / `bindings[]` / schedule route は current manifest
  surface ではない

関連:

- [Manifest Reference](/reference/manifest-spec)
- [環境変数](/deploy/environment)
- [Worker + DB](/examples/worker-with-db)
