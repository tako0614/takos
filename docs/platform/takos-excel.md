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
apiVersion: v1

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
    spec:
      routes:
        - /
        - /api
        - /api/auth/launch
        - /mcp
        - /healthz
        - /files/:id
    listen:
      jp.takos.excel.spreadsheets:
        as: env
        prefix: BLOB_
      operator.identity.oidc:
        as: env

  spreadsheets:
    kind: object-store
    publish:
      - jp.takos.excel.spreadsheets
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
