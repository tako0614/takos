# Worker + Container

> このページでわかること: request-driven Worker と long-running service
> を組み合わせる考え方。

Takosumi v1 AppSpec は kind-agnostic です。`worker` / `object-store` / `gateway`
などの短い kind 名は operator の alias map で解決されます。 container runtime は
operator/provider extension として扱い、OIDC のような identity surface は
operator-owned external publication を listen する形で受け取ります。

the route list in gateway `spec` belongs to the adopted gateway descriptor's
open `spec`. `host.spec.entrypoint` points to a runtime file already present in
the resolved source or prepared archive.

```yaml
apiVersion: v1
metadata:
  id: example.processor
  name: Processor
components:
  host:
    kind: worker
    spec:
      entrypoint: src/host.ts
    publish:
      http:
        as: http-endpoint
    listen:
      media:
        from: media.bucket
        as: secret-env
        prefix: BLOB
  media:
    kind: object-store
    publish:
      bucket:
        as: object-store
  public:
    kind: gateway
    listen:
      upstream:
        from: host.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        public:
          protocol: https
          host: processor.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

launcher / health endpoint は gateway descriptor spec と Takos product metadata
で表現します。

重い処理を container に逃がす必要がある場合は、operator distribution が提供する
provider extension、または app 層の外部 service として扱います。 portable
AppSpec では worker が HTTP material を publish し、gateway が public entrypoint
になります。DB / object-store / HTTP などの data dependency は `publish` /
`listen` で受け取り、source / runtime files は prepared source で渡します。
optional blob は operator DataAsset extension の領域です。

## ホスト側コード

```typescript
// src/host.ts
interface Env {
  BLOB_BUCKET: string;
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    return Response.json({ ok: true, bucket: env.BLOB_BUCKET });
  },
};
```

## ポイント

- AppSpec portable core では component kind を opaque string として扱い、 alias
  / URI の意味は operator が提供する documented contract として ship する
- operator-specific container は provider extension として docs を分ける
- resource 間の接続は string interpolation ではなく `publish.<name>.as` /
  `listen.<binding>.from` で宣言する

## 次のステップ

- MCP Server を公開したい→ [MCP Server](/examples/mcp-server)
- 完全な構成例→ [AppSpec](https://takosumi.com/docs/reference/manifest)
