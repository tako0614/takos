# ルーティング

> このページでわかること: Shape リソースで公開エンドポイントを宣言する方法。

- `worker@v1` uses `spec.routes: string[]`.
- `web-service@v1` exposes a service URL and may use `spec.domains: string[]`
  when the provider supports direct domains.
- `custom-domain@v1` creates a DNS/TLS resource that points at another resource
  output, usually `${ref:<web-service>.url}` or `${ref:<worker>.url}`.

The normative field list is
[Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md).

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

Use direct `spec.domains` only when the selected provider documents support for
it. For portable custom hostnames, prefer `custom-domain@v1`.

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

## Validation

- `worker@v1.spec.routes` must be an array of non-empty strings.
- `web-service@v1.spec.scale` is required.
- `custom-domain@v1.spec.name` and `custom-domain@v1.spec.target` are required.
- `custom-domain@v1.requires` must be satisfied by the selected provider.

## Next

- [Environment](/deploy/environment)
- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
