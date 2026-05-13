# ルーティング

> このページでわかること: Shape リソースで公開エンドポイントを宣言する方法。

公開エンドポイントの宣言方法は Shape ごとに異なります:

- `worker@v1` — `spec.routes: string[]` を使います
- `web-service@v1` — service URL を出力します。プロバイダが対応していれば
  `spec.domains: string[]` で直接ドメインを指定できます
- `custom-domain@v1` — 他リソースの output (通常は `${ref:<web-service>.url}` /
  `${ref:<worker>.url}`) を指す DNS/TLS リソースを作ります

フィールドの正式定義は
[Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
を参照してください。

## Worker Routes

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: docs
resources:
  - shape: worker@v1
    name: web
    provider: "@takos/cloudflare-workers"
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:0123456789abcdef
      compatibilityDate: "2026-05-09"
      routes:
        - docs.example.com/*
        - docs.example.com/api/*
```

## Web Service Domains

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      domains:
        - api.example.com
```

`spec.domains` を直接指定するのは、選んだプロバイダがそのフィールドをサポート
していると明示している場合だけにしてください。ポータブルなカスタムホスト名は
`custom-domain@v1` を使うのが安全です。

## Custom Domains

```yaml
apiVersion: "1.0"
kind: Manifest
metadata:
  name: api-with-domain
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: custom-domain@v1
    name: api-domain
    provider: "@takos/cloudflare-dns"
    spec:
      name: api.example.com
      target: ${ref:api.url}
      certificate:
        kind: auto
```

## バリデーション

- `worker@v1.spec.routes` は非空の文字列配列でなければなりません
- `web-service@v1.spec.scale` は必須です
- `custom-domain@v1.spec.name` と `custom-domain@v1.spec.target` は必須です
- `custom-domain@v1.requires` は選んだプロバイダが満たす必要があります

## 次に読むページ

- [Environment](/deploy/environment)
- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
