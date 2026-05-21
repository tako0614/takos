# Worker + Container

> このページでわかること: request-driven Worker と long-running service を組み合わせる考え方。

> **Wave N planned (2026-05-21 RFC stage)**: 本サンプルが使う `build:` field と
> curated 4 kind (= worker / postgres / object-store / custom-domain) は
> takosumi Wave N で削除予定 (= kernel pure contract executor 化、 build は
> 別 `kind: build` component に移管、 specific kind は operator distribution
> が JSON-LD + plugin で持ち込む)。 詳細 design は takosumi
> [RFC 0001](https://takosumi.com/docs/rfc/0001-kernel-kind-agnostic) を参照。
> 現状のサンプルは引き続き動作します。

Takosumi v1 AppSpec の core kind catalog は `worker` / `postgres` / `object-store` /
`custom-domain` を含み、 catalog は extensible (alias / URI で拡張可) です。 container
runtime は operator/provider extension として扱い、 OIDC のような identity surface は
takosumi-cloud が publish する namespace を listen する形で受け取ります。

```yaml
apiVersion: v1
metadata:
  id: example.processor
  name: Processor
components:
  host:
    kind: worker
    build:
      command: npm ci && npm run build:host
      output: dist/host.mjs
    spec:
      routes:
        - processor.example.com/*
    listen:
      example.processor.media:
        as: env
        prefix: BLOB_
  media:
    kind: object-store
    publish:
      - example.processor.media
```

> launcher / health endpoint は worker materializer convention (= `spec.routes`
> の HTTP path) で表現します (= Wave J で top-level `interfaces:` は AppSpec
> から物理削除済)。

重い処理を container に逃がす必要がある場合は、operator distribution が提供する
provider extension、または app 層の外部 service として扱います。 portable AppSpec
では worker が public entrypoint になり、 必要な data asset を namespace pub/sub
(`publish` / `listen`) で受け取ります。

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

- AppSpec portable core では component kind を catalog から選び、 alias / URI による
  拡張 kind は documented contract として ship する
- operator-specific container は provider extension として docs を分ける
- resource 間の接続は string interpolation ではなく namespace pub/sub
  (`publish` / `listen`) で宣言する

## 次のステップ

- MCP Server を公開したい → [MCP Server](/examples/mcp-server)
- 完全な構成例 → [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
