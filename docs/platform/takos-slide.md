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
apiVersion: takosumi.dev/v1
kind: App

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
    routes:
      - /
      - /api
      - /mcp
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

interfaces:
  launch:
    target: web
    path: /api/auth/launch
  mcp:
    target: web
    path: /mcp
  health:
    target: web
    path: /healthz

permissions:
  requested:
    - files:read
    - files:write
    - logs.read.own
```

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [OIDC Consumer](/apps/oidc-consumer)
