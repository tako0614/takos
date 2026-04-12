# Worker + Container

> このページでわかること: Worker と Docker コンテナを組み合わせる方法。

takos-agent と同じアーキテクチャです。ブラウザ自動化やヘビーな処理など、Docker
が必要な場合に使います。

この例は現行の `takos deploy`（ローカル manifest）で読める構成に合わせています。
同じ manifest は repo/ref source の `takos deploy URL` や catalog package install
でも使えます。

## app.yml

```yaml
name: browser-service

compute:
  browser-host:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-host
        artifact: browser-host
        artifactPath: dist/host.js
    containers:
      browser:
        image: ghcr.io/example/browser-service@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 8080
        instanceType: standard-2
        scaling:
          maxInstances: 10

routes:
  - target: browser-host
    path: /api
  - target: browser-host
    path: /gui

env:
  API_SECRET: ""
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

- `compute.<name>.containers` でコンテナを Worker 内に定義します
- コンテナは worker-attached container workload として実行されます
- Worker がルーティングを担当し、コンテナがヘビーな処理を担当します
- `instanceType` でコンテナのスペックを指定できます（`basic`, `standard-2`
  など）
- `maxInstances` で最大インスタンス数を制御します

## compute の 3 形態

|            | Worker                     | Service                      | Worker + Attached Container  |
| ---------- | -------------------------- | ---------------------------- | ---------------------------- |
| 判定条件   | `build` あり               | `image` あり（`build` なし） | `build` + `containers` あり  |
| 実行モデル | serverless, request-driven | always-on container          | worker に container が紐づく |
| 用途       | ルーティング、軽量処理     | 独立稼働する Docker コンテナ | Docker が必要な処理          |
| deploy source | workflow artifact       | digest-pinned `image`        | workflow artifact + `image`  |

## 次のステップ

- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
- コンテナの詳細 → [Containers ガイド](/apps/containers)
- 実際の takos-agent の構成 → [app.yml リファレンス](/apps/manifest#完全な例)
