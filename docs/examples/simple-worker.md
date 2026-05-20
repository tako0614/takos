# Simple Worker

> このページでわかること: `worker` component 1 つだけの最小 AppSpec。

## 完成形

```text
my-app/
├── .takosumi.yml
├── src/
│   └── index.ts
└── package.json
```

## `.takosumi.yml`

```yaml
apiVersion: v1
metadata:
  id: example.simple-worker
  name: Simple Worker
  description: Minimal worker app
  publisher: example
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    spec:
      routes:
        - simple-worker.example.com/*
```

> Wave J で AppSpec から `interfaces:` / `permissions:` top-level field を
> 物理削除しました。 launcher / health endpoint / capability request は
> worker materializer 慣習 (= `spec.routes` の HTTP path), 別 kind, または
> namespace pub/sub のいずれかで表現します (= 「底は自由」 原則)。

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

## Dry-run / apply

```bash
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
```

## Points

- `apiVersion: v1` is required (= AppSpec root discriminator).
- `components.web.kind: worker` declares the runtime-bearing unit.
- `components.web.build.output` points to the generated worker bundle.
- `components.web.spec.routes` are HTTP route patterns the worker
  materializer reads (= implementation convention, not part of the
  AppSpec kind contract).

## Next

- Add data storage: [Worker + DB](/examples/worker-with-db)
- Add a container service: [Worker + Container](/examples/worker-with-container)
- Publish an MCP endpoint: [MCP Server](/examples/mcp-server)
