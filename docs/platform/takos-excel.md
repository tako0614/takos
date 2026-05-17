# takos-excel

> このページでわかること: バンドルアプリ takos-excel の概要。

スプレッドシートエディタ with formulas and a Streamable HTTP MCP server。

## 役割

- スプレッドシートの作成・編集・閲覧 + formula 評価
- agent が直接使える published MCP tool surface
- Cloudflare Workers backend
- Takosumi Accounts OIDC consumer

## AppSpec (`.takosumi.yml`)

```yaml
apiVersion: takosumi.dev/v1
kind: App

metadata:
  id: jp.takos.excel
  name: Takos Excel
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
    use:
      spreadsheets:
        envPrefix: BLOB_
      auth:
        mount: oidc

  spreadsheets:
    kind: object-store

  auth:
    kind: oidc
    redirectPaths:
      - /api/auth/callback
    scopes: [openid, profile, email]

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
