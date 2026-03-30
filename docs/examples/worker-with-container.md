# Worker + Container

> このページでわかること: Worker と Docker コンテナを組み合わせる方法。

takos-computer と同じアーキテクチャです。ブラウザ自動化やヘビーな処理など、Docker が必要な場合に使います。

この例は現行の `takos apply` で読める構成に合わせています。Store 経由の `takos deploy` / app-deployments はまだ end-to-end ではありません。

## app.yml

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: browser-service
spec:
  version: 1.0.0
  description: Browser automation service
  category: service
  tags:
    - browser
    - automation

  containers:
    browser:
      dockerfile: Dockerfile
      port: 8080
      instanceType: standard-2
      maxInstances: 10

  workers:
    browser-host:
      containers: [browser]
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: build-host
          artifact: browser-host
          artifactPath: dist/host.js

  routes:
    - name: api
      target: browser-host
      path: /api
    - name: gui
      target: browser-host
      path: /gui

  env:
    required:
      - API_SECRET
```

## ワークフロー

```yaml
# .takos/workflows/deploy.yml
name: deploy
jobs:
  build-host:
    steps:
      - name: Install dependencies
        run: npm install
      - name: Build host worker
        run: npm run build:host
    artifacts:
      browser-host:
        path: dist/host.js
```

## Dockerfile

```dockerfile
# Dockerfile
FROM node:20-slim

RUN npx playwright install --with-deps chromium

WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/

EXPOSE 8080
CMD ["node", "dist/server.js"]
```

## Worker のコード（ホスト側）

```typescript
// src/host.ts
interface Env {
  BROWSER_CONTAINER: DurableObjectNamespace;
  API_SECRET: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 認証チェック
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${env.API_SECRET}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    // コンテナにリクエストを転送
    const id = env.BROWSER_CONTAINER.idFromName("default");
    const stub = env.BROWSER_CONTAINER.get(id);
    return stub.fetch(request);
  },
};
```

## ポイント

- `containers` でコンテナを定義し、`workers` の `containers` フィールドで紐づけます
- コンテナは CF Containers (Durable Object) として実行されます
- Worker がルーティングを担当し、コンテナがヘビーな処理を担当します
- `instanceType` でコンテナのスペックを指定できます（`basic`, `standard-2` など）
- `maxInstances` で最大インスタンス数を制御します

## containers, services, workers の使い分け

| | containers | services | workers |
| --- | --- | --- | --- |
| 実行モデル | CF Containers (Durable Object) | 常設コンテナ (VPS) | CF Workers (V8 isolate) |
| 用途 | Docker が必要な処理 (Worker に紐づく) | 独立稼働する Docker コンテナ | ルーティング、軽量処理 |
| ビルド | Dockerfile | Dockerfile | workflow artifact |
| IPv4 割当 | 不可 | `ipv4: true` で可能 | 不可 |

## 常設サービス

Worker に紐づけず、コンテナ単体で独立稼働させる場合は `services` セクションを使います。`ipv4: true` を指定すると専用 IPv4 が割り当てられます。

```yaml
services:
  my-api:
    dockerfile: Dockerfile
    port: 3000
    ipv4: true
```

## 次のステップ

- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
- コンテナの詳細 → [Containers ガイド](/apps/containers)
- 実際の takos-computer の構成 → [app.yml リファレンス](/apps/manifest#完全な例)
