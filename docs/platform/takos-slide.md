# takos-slide

> このページでわかること: バンドルアプリ takos-slide の概要。

プレゼンテーションエディタ with a Streamable HTTP MCP server。

## 役割

- スライドの作成・編集・閲覧
- agent が直接使える published MCP tool surface
- Cloudflare Workers backend
- Takosumi Accounts OIDC consumer

## AppSpec (`.takosumi.yml`)

```yaml
apiVersion: v1

metadata:
  id: jp.takos.slide
  name: Takos Slide
  publisher: takos

components:
  web:
    kind: worker
    build:
      command: deno task build
      output: dist/worker.mjs
    spec:
      routes:
        - /
        - /api
        - /api/auth/launch
        - /mcp
        - /healthz
        - /files/:id
    listen:
      jp.takos.slide.presentations:
        as: env
        prefix: BLOB_
      operator.identity.oidc:
        as: env

  presentations:
    kind: object-store
    publish:
      - jp.takos.slide.presentations
```

> Wave J で AppSpec から top-level `interfaces:` / `permissions:` / `routes:`
> field は物理削除済。 launcher (`/api/auth/launch`) / MCP (`/mcp`) / health
> (`/healthz`) endpoint は worker materializer convention (= `spec.routes`
> の HTTP path) と Takos product 内部 app launcher / MCP registry metadata
> (= AppSpec contract とは別 layer) で表現します。 capability request
> (= かつての `permissions.requested[]`) は Takos product 内部 metadata layer
> で表現します。

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [OIDC Consumer](/apps/oidc-consumer)
