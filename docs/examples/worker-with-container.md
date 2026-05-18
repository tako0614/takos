# Worker + Container

> このページでわかること: request-driven Worker と long-running service を組み合わせる考え方。

Takosumi v1 AppSpec の current public component catalog は `worker` /
`postgres` / `object-store` / `oidc` / `custom-domain` です。container runtime は
operator/provider extension として扱い、AppSpec の portable core には入れません。

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: example.processor
  name: Processor
components:
  host:
    kind: worker
    build:
      command: npm ci && npm run build:host
      output: dist/host.mjs
    routes:
      - processor.example.com/*
    use:
      media:
        envPrefix: BLOB_
  media:
    kind: object-store
interfaces:
  launch:
    target: host
    path: /
  health:
    target: host
    path: /healthz
```

重い処理を container に逃がす必要がある場合は、operator distribution が提供する
provider extension、または app 層の外部 service として扱います。portable AppSpec
では worker が public entrypoint になり、必要な data asset を `use:` edge で受け取ります。

## ホスト側コード

```typescript
// src/host.ts
interface Env {
  BLOB_BUCKET_NAME: string;
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    return Response.json({ ok: true, bucket: env.BLOB_BUCKET_NAME });
  },
};
```

## ポイント

- AppSpec portable core では component kind を catalog 5 種に保つ
- operator-specific container は provider extension として docs を分ける
- resource 間の接続は string interpolation ではなく `use:` edge で宣言する

## 次のステップ

- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
- 完全な構成例 → [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
