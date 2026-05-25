# Simple Worker

> このページでわかること: worker と gateway で public app endpoint を作る最小
> AppSpec。

## 完成形

```text
my-app/
├── .takosumi.yml
├── src/
│   └── index.ts
└── package.json
```

## `.takosumi.yml`

Short kind names are operator-profile aliases. The route list in gateway `spec`
belongs to the adopted gateway descriptor's open `spec`. `web.spec.entrypoint`
points to a runtime file already present in the resolved source or prepared
archive.

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
    spec:
      entrypoint: src/index.ts
    publish:
      http:
        as: http-endpoint
  public:
    kind: gateway
    listen:
      upstream:
        from: web.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        public:
          protocol: https
          host: simple-worker.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

public app endpoint は adopted gateway/ingress component の gateway descriptor intent、launcher / health /
capability は Takos product metadata や kind-specific spec で表現します。

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
- `components.web.spec.entrypoint` points at the runtime file in the resolved
  source snapshot.
- `components.web.publish.http` offers an internal HTTP endpoint.
- `components.public` turns that endpoint into public ingress with listener /
  gateway descriptor intent.

## Next

- Add data storage: [Worker + DB](/examples/worker-with-db)
- Add a container service: [Worker + Container](/examples/worker-with-container)
- Publish an MCP endpoint: [MCP Server](/examples/mcp-server)
