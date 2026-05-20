# takos-docs

> このページでわかること: バンドルアプリ takos-docs の概要。

rich text document editor with a Streamable HTTP MCP server。

## 役割

- Tiptap ベースのリッチテキストエディタ
- ドキュメントの作成・編集・閲覧
- agent が直接使える published MCP tool surface
- Cloudflare Workers backend で worker bundle を host
- Takosumi Accounts OIDC consumer

## AppSpec (`.takosumi.yml`)

```yaml
apiVersion: v1

metadata:
  id: jp.takos.docs
  name: Takos Docs
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
      jp.takos.docs.documents:
        as: env
        prefix: BLOB_
      operator.identity.oidc:
        as: env

  documents:
    kind: object-store
    publish:
      - jp.takos.docs.documents

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

## OIDC consumer

`listen: { operator.identity.oidc: { as: env } }` を宣言すると、 takosumi-cloud
(operator account plane) が provider として per-Installation OIDC client を発行し、
`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URIS`
を worker に env で inject します。 OIDC kind 自体は AppSpec に書きません。
詳細は [OIDC Consumer](/apps/oidc-consumer)。

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [Component Kind Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/component-kind-catalog.md)
