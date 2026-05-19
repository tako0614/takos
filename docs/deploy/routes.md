# ルーティング

> このページでわかること: AppSpec の worker component で公開エンドポイントを
> 宣言する方法。

Takosumi の Wave J Component contract minimization で AppSpec から
`Component.routes` / `AppSpec.interfaces` / `AppSpec.permissions` の top-level
field を物理削除しました。 公開エンドポイント (= HTTP route / launcher path /
MCP endpoint / health check path) は次のいずれかで表現します:

- worker component の **`spec.routes`** (= worker materializer の実装慣習。
  `@takos/takosumi-cloudflare-providers` 等の shape provider が HTTP route
  pattern を読み取って materialize する)
- 専用 `custom-domain` component (= portable な独自ドメイン)
- 別 kind / namespace pub/sub で operator が表現する任意 layer

フィールドの正式定義は
[AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
を参照してください。

## Worker Routes

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: example.docs
  name: Docs
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    spec:
      routes:
        - docs.example.com/*
        - docs.example.com/api/*
```

## Custom Domain

```yaml
apiVersion: takosumi.dev/v1
kind: App
metadata:
  id: example.api
  name: API
components:
  api:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/api.mjs
    routes:
      - /
  publicDomain:
    kind: custom-domain
    name: api.example.com
    target: api
interfaces:
  launch:
    target: api
    path: /
```

## バリデーション

- route-bearing component は `routes` に非空の文字列配列を持つ
- `custom-domain.name` は operator が許可した hostname でなければならない
- `custom-domain.target` は同じ AppSpec 内の component を指す
- `interfaces.*.target` は route-bearing component を指す

## 次に読むページ

- [Environment](/deploy/environment)
- [AppSpec namespace pub/sub](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
