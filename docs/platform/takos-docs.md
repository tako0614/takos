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
    spec:
      routes:
        - /
        - /api
        - /api/auth/launch
        - /mcp
        - /healthz
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
```

> Wave J で AppSpec から top-level `interfaces:` / `permissions:` / `routes:`
> field は物理削除済。 launcher (`/api/auth/launch`) / MCP (`/mcp`) / health
> (`/healthz`) endpoint は worker materializer convention (= `spec.routes`
> の HTTP path) と Takos product 内部 app launcher / MCP registry metadata
> (= AppSpec contract とは別 layer) で表現します。 capability request
> (= かつての `permissions.requested[]`) は Takos product 内部 metadata layer
> で表現します。

## OIDC consumer

`listen: { operator.identity.oidc: { as: env } }` を宣言すると、 takosumi-cloud
(operator account plane) が provider として per-Installation OIDC client を発行し、
`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URIS`
を worker に env で inject します。 OIDC kind 自体は AppSpec に書きません。
詳細は [OIDC Consumer](/apps/oidc-consumer)。

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [Component Kind Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/component-kind-catalog.md)
