# Simple Worker

> このページでわかること: `worker` component 1 つだけの最小 AppSpec。

> **Wave N planned (2026-05-21 RFC stage)**: 本サンプルが使う `build:` field と
> `kind: worker` は、 takosumi Wave N で削除/再定義予定 (= kernel pure contract
> executor 化、 build は別 `kind: build` component に移管、 worker kind は
> operator distribution が JSON-LD + plugin で持ち込む)。 詳細 design は
> takosumi [RFC 0001](https://takosumi.com/docs/rfc/0001-kernel-kind-agnostic)
> を参照。 現状のサンプルは引き続き動作します。

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
