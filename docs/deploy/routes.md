# ルーティング

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: AppSpec で workload を public app endpoint
> として公開する方法。

公開エンドポイントの外側の入口 (= hostname / TLS / route rule) は、通常の
component graph として表現します:

- workload は `http-endpoint` material を `publish` する
- `gateway` のような ingress component がその publication を `listen` する
- public hostname / TLS / route rule は ingress component の kind-specific
  `spec` に書く

`/mcp`、`/files/:id`、OIDC callback、health check などの runtime path は
workload 実装と Takos app metadata / registry が扱います。AppSpec は public
endpoint の material と ingress intent をつなぎます。

runtime request は provider-native ingress から workload に直接届きます。
Takosumi kernel が request ごとの HTTP proxy になることは要求されません。

フィールドの正式定義は [AppSpec](https://takosumi.com/docs/reference/app-spec)
を参照してください。

## Public app endpoint

```yaml
apiVersion: v1
metadata:
  id: example.docs
  name: Docs
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker.ts
    publish:
      http:
        as: http-endpoint
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
          host: docs.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

`web.http` は upstream material です。それだけでは public ingress
ではありません。 `public` component が host / TLS / gateway descriptor intent
を持ち、operator の domain policy と activation を通った後に public endpoint
になります。`/api` などの runtime path は worker/web-service 側が処理します。

## Custom Domain

```yaml
apiVersion: v1
metadata:
  id: example.api
  name: API
components:
  api:
    kind: worker
    spec:
      entrypoint: src/api.ts
    publish:
      http:
        as: http-endpoint
  public:
    kind: gateway
    listen:
      upstream:
        from: api.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        api:
          protocol: https
          host: api.example.com
          tls: auto
      routes:
        - listener: api
          path: /
          to: upstream
```

## バリデーション

- `listen.<binding>.from` は同じ AppSpec 内の `component.publication` か
  external publication path に解決できる
- `host` は operator が許可した hostname でなければならない
- custom domain は account-plane / provider flow で DNS ownership proof と
  conflict check を通す

## 次に読むページ

- [Environment](/deploy/environment)
- [AppSpec publish/listen](https://takosumi.com/docs/reference/app-spec)
