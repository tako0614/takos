# JS bundle component だけのシンプルな group

> このページでわかること: component 1 つだけの最小構成の書き方。

この例は
[Canonical minimal manifest](/reference/manifest-spec#canonical-minimal-manifest)
そのままの構成です。

## 完成形

```text
my-app/
├── .takos/
│   ├── app.yml
│   └── workflows/
│       └── deploy.yml
├── src/
│   └── index.ts
└── package.json
```

## deploy manifest

```yaml
name: simple-worker

components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: bundle
              artifact: web
              entry: dist/worker.js
      ui:
        ref: interface.http@v1

routes:
  - id: web
    expose: { component: web, contract: ui }
    via:
      ref: route.https@v1
      config: { path: / }
```

## ワークフロー

```yaml
# .takos/workflows/deploy.yml
name: deploy
jobs:
  bundle:
    runs-on: ubuntu-latest
    steps:
      - name: Install dependencies
        run: npm install
      - name: Build
        run: npm run build
    artifacts:
      web:
        path: dist/worker
```

## Worker のコード

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

## デプロイ

```bash
takos deploy --env staging --space SPACE_ID
```

## ポイント

- `name` は display 名であり、 deploy / install 時の既定 group 名にもなる
- `components.web.contracts.runtime` で component の runtime descriptor
  (`runtime.js-worker@v1`) を pin
- `components.web.contracts.ui` で `interface.http@v1` の expose 可能 endpoint を declaration
- `routes[]` で `expose` (どの component / contract) と `via` (route descriptor) を bind
- `path: /` でルートパスに公開。 ドメインはシステムが自動付与する
- component のコードは標準 Fetch API の `fetch` ハンドラ

## 次のステップ

- データベースを追加したい →
  [Component + SQL データベース](/examples/worker-with-db)
- 子 component を併設したい →
  [Component + 子 component](/examples/worker-with-container)
- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
