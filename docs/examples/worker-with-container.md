# Component + 子 component (sidecar)

> このページでわかること: JS bundle component と OCI container component を
> 組み合わせる方法。

旧 worker + attached container pattern と同じ用途です。 親 component が
ルーティング、 子 component が重い処理を担当します。

新 schema では「attached container」 は別 component として declaration
します。 `runtime.oci-container@v1` を ref に持つ component を `depends:` で
親に紐付け、 親から runtime binding 経由で呼び出します。

## deploy manifest

```yaml
name: processor-service

components:
  processor-host:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
        config:
          source:
            ref: artifact.workflow-bundle@v1
            config:
              workflow: .takos/workflows/deploy.yml
              job: build-host
              artifact: processor-host
              entry: dist/host.js
      api:
        ref: interface.http@v1
      gui:
        ref: interface.http@v1
  processor:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
        config:
          source:
            ref: artifact.oci-image@v1
            config:
              image: ghcr.io/example/processor-service@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          port: 8080
      gateway:
        ref: interface.http@v1
    depends: [processor-host]

resources:
  api-secret:
    ref: resource.secret@v1
    config: { generate: true }

bindings:
  - from: { secret: api-secret }
    to: { component: processor-host, env: API_SECRET }
  - from: { secret: api-secret }
    to: { component: processor, env: API_SECRET }

routes:
  - id: api
    expose: { component: processor-host, contract: api }
    via: { ref: route.https@v1, config: { path: /api } }
  - id: gui
    expose: { component: processor-host, contract: gui }
    via: { ref: route.https@v1, config: { path: /gui } }
```

## ワークフロー

```yaml
# .takos/workflows/deploy.yml
name: deploy
jobs:
  build-host:
    runs-on: ubuntu-latest
    steps:
      - name: Install dependencies
        run: npm install
      - name: Build host bundle
        run: npm run build:host
    artifacts:
      processor-host:
        path: dist/host.js
```

## Dockerfile

```dockerfile
# Dockerfile
FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/

EXPOSE 8080
CMD ["node", "dist/server.js"]
```

## ホスト側コード

```typescript
// src/host.ts
interface Env {
  PROCESSOR_GATEWAY: Fetcher;        // 子 component の interface.http instance
  API_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.API_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }
    return env.PROCESSOR_GATEWAY.fetch(request);
  },
};
```

## ポイント

- 子 component は `runtime.oci-container@v1` を ref に持つ独立 component
  として宣言する (旧 `containers:` 配下ではない)
- `depends: [processor-host]` で起動順序の hint を declaration
- 共通 secret は `resource.secret@v1` を作って **親と子の両方** に明示 binding
- 子 component を外に直接公開する場合は子側の `interface.http@v1`
  contract instance を route で `expose` する。 親経由でないと届かないわけではない

## runtime descriptor の選び分け

| component の特性                 | runtime ref                     | source ref                     |
| -------------------------------- | ------------------------------- | ------------------------------ |
| serverless / request-driven JS    | `runtime.js-worker@v1`          | `artifact.workflow-bundle@v1`  |
| 常設 container                    | `runtime.oci-container@v1`      | `artifact.oci-image@v1`        |

provider 選択 (Cloudflare Workers / Cloud Run / k8s) は `provider-selection`
policy gate と operator-only configuration が決定する。 manifest には
provider 名は出ない。

## 次のステップ

- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
- 完全な構成例 → [Deploy Manifest リファレンス](/reference/manifest-spec)
