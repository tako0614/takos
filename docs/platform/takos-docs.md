# takos-docs

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: バンドルアプリ takos-docs の概要。

rich text document editor with a Streamable HTTP MCP server。

## 役割

- Tiptap ベースのリッチテキストエディタ
- ドキュメントの作成・編集・閲覧
- agent が直接使える published MCP tool surface
- Cloudflare Workers backend で worker bundle を host
- Takosumi Accounts OIDC consumer

## AppSpec (`.takosumi.yml`)

`spec.entrypoint` points to a runtime file inside the resolved source. Managed
install uses the prepared source produced by the build service when that file is
generated; direct Git/local apply is valid only when the file is already present
in the source snapshot.

```yaml
apiVersion: v1

metadata:
  id: jp.takos.docs
  name: Takos Docs
  publisher: takos

components:
  web:
    kind: worker
    spec:
      entrypoint: dist/worker.js
    publish:
      http:
        as: http-endpoint
    listen:
      documents:
        from: documents.bucket
        as: secret-env
        prefix: BLOB
      oidc:
        from: operator.identity.oidc
        as: secret-env
        prefix: OIDC
        required: true

  public:
    kind: gateway
    listen:
      upstream:
        from: web.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        public:
          protocol: https
      routes:
        - listener: public
          path: /
          to: upstream

  documents:
    kind: object-store
    spec:
      name: takos-docs-documents
    publish:
      bucket:
        as: object-store
```

gateway は public endpoint を作り、worker が app runtime path
を処理します。Takos product metadata は launcher / MCP registry / capability
request を登録します。

## OIDC consumer

`listen.oidc.from: operator.identity.oidc` を宣言すると、 takosumi-cloud
(operator account plane) が per-Installation OIDC client を発行し、
`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URI` を secretRef-mediated runtime env で inject します。詳細は
[OIDC Consumer](/apps/oidc-consumer)。

## 関連ページ

- [AppSpec spec](https://takosumi.com/docs/reference/app-spec)
- [takosumi.com Type Catalog](https://takosumi.com/docs/reference/type-catalog)
