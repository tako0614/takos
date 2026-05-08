# Worker + Container

> このページでわかること: request-driven Worker と long-running container を
> current `resources[]` manifest で組み合わせる方法。

旧 attached container pattern は、current manifest では `worker@v1` と
`web-service@v1` の 2 resource として表現します。Worker が edge entrypoint
を持ち、container は internal service として重い処理を担当します。

## Deploy Manifest

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: processor-service
resources:
  - shape: web-service@v1
    name: processor
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/processor-service@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: worker@v1
    name: processor-host
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: PLACEHOLDER
      compatibilityDate: "2026-05-09"
      routes:
        - processor.example.com/api/*
        - processor.example.com/gui/*
      env:
        PROCESSOR_INTERNAL_HOST: ${ref:processor.internalHost}
        PROCESSOR_INTERNAL_PORT: ${ref:processor.internalPort}
    workflowRef:
      file: .takosumi/workflows/deploy.yml
      job: build-host
      artifact: processor-host
      target: spec.artifact.hash
```

`workflowRef` は takosumi-git の authoring extension です。kernel に届く
compiled manifest では `spec.artifact.hash` が concrete digest
になり、`workflowRef` は 存在しません。

## ワークフロー

```yaml
# .takosumi/workflows/deploy.yml
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
  PROCESSOR_INTERNAL_HOST: string;
  PROCESSOR_INTERNAL_PORT: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    url.protocol = "http:";
    url.hostname = env.PROCESSOR_INTERNAL_HOST;
    url.port = env.PROCESSOR_INTERNAL_PORT;
    return fetch(url, request);
  },
};
```

## ポイント

- long-running process は `web-service@v1`、edge entrypoint は `worker@v1`
  として分ける
- provider は manifest に明示する。operator-only config は provider plugin 側で
  管理する
- resource 間の接続は provider output (`internalHost` / `internalPort`) を
  `${ref:...}` で受け取る
- top-level `components` / `bindings[]` / `routes[]` は current manifest surface
  ではない

## 次のステップ

- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
- 完全な構成例 → [Deploy Manifest リファレンス](/reference/manifest-spec)
