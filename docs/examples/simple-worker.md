# Simple Worker

> このページでわかること: `worker@v1` resource 1 つだけの最小構成。

この例は
[最小マニフェスト](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md#canonical-minimal-manifest)
の Shape model に従います。

## 完成形

```text
my-app/
├── .takosumi/
│   ├── app.yml
│   ├── manifest.yml
│   └── workflows/
│       └── build.yml
├── src/
│   └── index.ts
└── package.json
```

## app.yml

```yaml
apiVersion: app.takosumi.dev/v1
kind: App
metadata:
  id: example.simple-worker
  name: Simple Worker
  description: Minimal worker app
  publisher: example
source:
  git: https://github.com/example/simple-worker
  ref: v1.0.0
entry:
  manifest: .takosumi.yml
runtime:
  modes:
    - shared-cell
permissions:
  requested: []
```

## manifest.yml

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: simple-worker
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      routes:
        - simple-worker.example.com/*
    workflowRef:
      file: build.yml
      job: build-worker
      artifact: bundle
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git の private extension です。`push` /
`install apply` が workflow を実行し、`TAKOSUMI_ARTIFACT=<hash>` を
`spec.artifact.hash` に書き込んでから `workflowRef` を strip します。kernel には
`workflowRef` は届きません。

## Workflow

```yaml
version: "0"
jobs:
  - name: build-worker
    steps:
      - name: install
        run: npm install
      - name: build
        run: npm run build
      - name: upload
        run: |
          # Replace this with the provider uploader. It must print an immutable
          # bundle hash or URI according to the Artifact URI Contract.
          echo "TAKOSUMI_ARTIFACT=sha256:0123456789abcdef"
    artifact:
      name: bundle
```

## Worker code

```typescript
// src/index.ts
export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("Hello from Takos!", {
        headers: { "content-type": "text/plain" },
      });
    }

    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }

    return new Response("Not Found", { status: 404 });
  },
};
```

## Dry run

```bash
takosumi-git push --dry-run
```

Dry-run prints the cleaned manifest. The printed resource should contain
`spec.artifact.hash: sha256:0123456789abcdef` and no `workflowRef`.

## Apply

```bash
takosumi-git push \
  --endpoint "$TAKOSUMI_ENDPOINT" \
  --token "$TAKOSUMI_TOKEN"
```

## Points

- `apiVersion: "1.0"` and `kind: Manifest` are required.
- `worker@v1` requires `spec.artifact.kind: js-bundle`, `spec.artifact.hash`,
  and `spec.compatibilityDate`.
- `spec.routes` is a provider-interpreted string array.
- `workflowRef.target: spec.artifact.hash` is what makes worker bundles work
  without abusing `spec.image`.

## Next

- Add data storage: [Worker + DB](/examples/worker-with-db)
- Add a container service: [Worker + Container](/examples/worker-with-container)
- Publish an MCP endpoint: [MCP Server](/examples/mcp-server)
