# ルーティング

> このページでわかること: AppSpec で公開エンドポイントを宣言する方法。

公開エンドポイントは `.takosumi.yml` の component と interface で宣言します。

- `components.<name>.routes` — provider が materialize する HTTP route
- `interfaces.launch` — Takos launcher が開く path
- `interfaces.mcp` — agent layer が discover する MCP endpoint
- `custom-domain` component — portable な独自ドメイン

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
    routes:
      - docs.example.com/*
      - docs.example.com/api/*
interfaces:
  launch:
    target: web
    path: /
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
