# takos-excel

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: バンドルアプリ takos-excel の概要。

スプレッドシートエディタ with formulas and a Streamable HTTP MCP server。

## 役割

- スプレッドシートの作成・編集・閲覧 + formula 評価
- agent が直接使える published MCP tool surface
- Cloudflare Workers backend
- Takosumi Accounts OIDC consumer

## AppSpec (`.takosumi.yml`)

`spec.entrypoint` points to a runtime file inside the resolved source. Managed
install uses the prepared source produced by the build service when that file is
generated; direct Git/local apply is valid only when the file is already present
in the source snapshot.

```yaml
apiVersion: v1

metadata:
  id: jp.takos.excel
  name: Takos Excel
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
      spreadsheets:
        from: spreadsheets.bucket
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

  spreadsheets:
    kind: object-store
    spec:
      name: takos-excel-spreadsheets
    publish:
      bucket:
        as: object-store
```

gateway は public endpoint を作り、worker が app runtime path
を処理します。Takos product metadata は launcher / MCP registry / capability
request を登録します。

## 関連ページ

- [AppSpec spec](https://takosumi.com/docs/reference/manifest)
- [OIDC Consumer](/apps/oidc-consumer)
