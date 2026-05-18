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
apiVersion: takosumi.dev/v1
kind: App
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
    routes:
      - simple-worker.example.com/*
interfaces:
  launch:
    target: web
    path: /
  health:
    target: web
    path: /api/health
permissions:
  requested: []
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

## Dry-run / apply

```bash
takosumi install dry-run --source . --space "$TAKOSUMI_SPACE_ID" --json
takosumi install --source . --space "$TAKOSUMI_SPACE_ID"
```

## Points

- `apiVersion: takosumi.dev/v1` and `kind: App` are required.
- `components.web.kind: worker` declares the runtime-bearing unit.
- `components.web.build.output` points to the generated worker bundle.
- `interfaces.launch` is what Takos uses to open the installed app.

## Next

- Add data storage: [Worker + DB](/examples/worker-with-db)
- Add a container service: [Worker + Container](/examples/worker-with-container)
- Publish an MCP endpoint: [MCP Server](/examples/mcp-server)
