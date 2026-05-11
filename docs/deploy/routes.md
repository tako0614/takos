# Routes

Current `.takosumi/manifest.yml` does not have a top-level `routes[]` field. Public entrypoints are declared inside
Shape resources:

- `worker@v1` uses `spec.routes: string[]`.
- `web-service@v1` exposes a service URL and may use `spec.domains: string[]` when the selected provider supports direct
  domains.
- `custom-domain@v1` creates a DNS/TLS resource that points at another resource output, usually
  `${ref:<web-service>.url}` or `${ref:<worker>.url}`.

The normative field list is
[Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md). The legacy
`routes[]` / component-contract route model is not part of the compiled Shape manifest.

## Worker Routes

`worker@v1` accepts route patterns as strings.

```yaml
apiVersion: '1.0'
kind: Manifest
metadata:
  name: docs
resources:
  - shape: worker@v1
    name: web
    provider: '@takos/cloudflare-workers'
    spec:
      artifact:
        kind: js-bundle
        hash: sha256:0123456789abcdef
      compatibilityDate: '2026-05-09'
      routes:
        - docs.example.com/*
        - docs.example.com/api/*
```

Provider adapters decide how the string patterns map to the target platform. For Cloudflare Workers, they are worker
route patterns.

## Web Service Domains

`web-service@v1` is an HTTP service. It always has a `url` output after apply. Some providers also support direct
`spec.domains`.

```yaml
apiVersion: '1.0'
kind: Manifest
metadata:
  name: api
resources:
  - shape: web-service@v1
    name: api
    provider: '@takos/aws-fargate'
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      domains:
        - api.example.com
```

Use direct `spec.domains` only when the provider contract documents support for it. For portable custom hostnames,
prefer `custom-domain@v1`.

## Custom Domains

`custom-domain@v1` is the portable DNS/TLS entrypoint shape. It points a public hostname at another resource output.

```yaml
apiVersion: '1.0'
kind: Manifest
metadata:
  name: api-with-domain
resources:
  - shape: web-service@v1
    name: api
    provider: '@takos/aws-fargate'
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: custom-domain@v1
    name: api-domain
    provider: '@takos/cloudflare-dns'
    spec:
      name: api.example.com
      target: ${ref:api.url}
      certificate:
        kind: auto
```

`custom-domain@v1` outputs `fqdn` and may output provider-specific certificate or nameserver evidence. Collision checks
and TLS lifecycle are provider responsibilities.

## Redirects

Providers that support the `redirects` capability can materialize redirects as part of `custom-domain@v1`.

```yaml
resources:
  - shape: custom-domain@v1
    name: www-redirect
    provider: '@takos/cloudflare-dns'
    requires: [redirects]
    spec:
      name: www.example.com
      target: https://example.com
      redirects:
        - from: https://www.example.com/*
          to: https://example.com/*
          code: 301
```

## Validation

- top-level `routes[]` is rejected by the manifest envelope validator.
- `worker@v1.spec.routes` must be an array of non-empty strings.
- `web-service@v1.spec.scale` is required.
- `custom-domain@v1.spec.name` and `custom-domain@v1.spec.target` are required.
- `custom-domain@v1.requires` must be satisfied by the selected provider.

## Next

- [Environment](/deploy/environment) — runtime env and binding placeholders
- [Manifest Reference](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md) — compiled
  Shape manifest field spec
- [Binding Catalog](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/binding-catalog.md) —
  install-time domain and service bindings
