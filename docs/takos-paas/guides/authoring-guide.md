# Takos PaaS Public Manifest Authoring Guide

Core is canonical and descriptor-pinned. Authors normally write the flat public
manifest (`.takos/app.yml`), and PaaS expands it to AppSpec / EnvSpec /
PolicySpec before the Deployment is resolved (see
[`core/01-core-contract-v1.0.md`](../core/01-core-contract-v1.0.md) § 4).

## Rule

```text
Authoring form is user-facing.
Canonical form is Deployment-resolution-facing.
```

Every public manifest convenience must expand before resolution finalizes. The
expansion descriptor/digest is recorded in
`Deployment.resolution.descriptor_closure`.

## Worker shorthand

Authoring form:

```yaml
name: web-app

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-web
        artifact: web
        artifactPath: dist/worker.js
```

Compiler result:

```yaml
components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1
```

`build.fromWorkflow.path` must be under `.takos/workflows/`. `artifactPath`,
when present, is repository-relative and must not contain path traversal.

## Service shorthand

Authoring form:

```yaml
name: api-app

compute:
  api:
    image: ghcr.io/acme/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
    port: 8080
```

Compiler result:

```yaml
components:
  api:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
        config:
          image: ghcr.io/acme/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
          port: 8080
```

Service `image` must be digest-pinned with a 64-hex `sha256` digest. Service
`port` is required because the runtime does not infer the listen port.

## Attached container

Authoring form:

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-web
        artifact: web
    containers:
      sandbox:
        image: ghcr.io/acme/sandbox@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
        port: 8080
```

Attached containers are declared below a worker. They also require a port.
Public routes target the parent worker/service, not the attached container.

For native Cloudflare Containers, the CLI/default-app manifest contract also
allows a repository-relative Dockerfile path in `image` when
`cloudflare.container` is present:

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: build-web
        artifact: web
    containers:
      sandbox:
        image: apps/sandbox/Dockerfile
        dockerfile: apps/sandbox/Dockerfile
        port: 8080
        cloudflare:
          container:
            binding: SANDBOX_CONTAINER
            className: SandboxSessionContainer
            instanceType: basic
            migrationTag: v1
```

## Routes

HTTP public manifest routes use the array form:

```yaml
routes:
  - id: ui
    target: web
    path: /
  - id: mcp
    target: web
    path: /mcp
    methods: [GET, POST]
```

`path` is required for HTTP routes and must start with `/`. `methods` are
normalized to uppercase; omitting `methods` means all HTTP methods. CLI
validation rejects duplicate route ids, duplicate `target + path`, and
overlapping methods for the same path. For HTTP/HTTPS the PaaS compiler
validates duplicate `target + host + path + methods`.

`source` is for PaaS event routes (`protocol: queue`, `protocol: schedule`, or
`protocol: event`). It names the event source and defaults to the route name
when omitted. HTTP public app manifests should not use `source`.

## Publication consume

Publication outputs are not injected automatically. Authors must select outputs
explicitly or opt into default output names.

```yaml
compute:
  web:
    consume:
      - publication: search
        as: search
        inject:
          env:
            url: SEARCH_MCP_URL
```

If a new output is added to a publication, it is not injected into an existing
binding unless `inject.defaults: true` covers that output.

## Built-in credential publications

Takos-owned credentials are consumed through built-in provider publications.
They are not declared in `publications[]` with `publisher: takos`.

```yaml
compute:
  web:
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
        inject:
          env:
            endpoint: TAKOS_API_URL
            apiKey: TAKOS_TOKEN
      - publication: takos.oauth-client
        as: app-oauth
        request:
          clientName: My App
          redirectUris:
            - /api/auth/callback
          scopes:
            - openid
            - profile
        inject:
          env:
            clientId: OAUTH_CLIENT_ID
            clientSecret: OAUTH_CLIENT_SECRET
            issuer: OAUTH_ISSUER_URL
            tokenEndpoint: OAUTH_TOKEN_URL
            userinfoEndpoint: OAUTH_USERINFO_URL
```

`takos.api-key` requires `request.scopes`. `takos.oauth-client` requires
`request.redirectUris` and `request.scopes`; `clientName` and `metadata` are
optional. Unknown request fields are invalid.

Default injection names are generated from the local consume name:
`PUBLICATION_<LOCAL_NAME>_<OUTPUT>`. Current defaults are `endpoint` / `apiKey`
for `takos.api-key`, and `clientId` / `clientSecret` / `issuer` for
`takos.oauth-client`. `tokenEndpoint` and `userinfoEndpoint` should be mapped
with `inject.env` when an app needs them.

## Publish catalog

Route-backed publications expose typed outputs that reference route ids.

```yaml
routes:
  - id: mcp
    target: web
    path: /mcp

publications:
  - name: web-mcp
    type: publication.mcp-server@v1
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http
```

`outputs.*.routeRef` must match a route id. Use the canonical publication types
(`publication.mcp-server@v1` / `publication.http-endpoint@v1` /
`publication.topic@v1`).

## Resource bindings

Resource credentials are not publication outputs. Resource access is represented
as manifest resources and runtime bindings.

```yaml
resources:
  db:
    type: sql
    bindings:
      web: DB
  session-secret:
    type: secret
    generate: true
    bind: APP_SESSION_SECRET
    to: web
```

Bindings target top-level compute names. Binding names must match
`[A-Za-z_][A-Za-z0-9_]*` and are normalized to uppercase.

## Environment overrides

```yaml
overrides:
  production:
    env:
      LOG_LEVEL: warn
    compute:
      web:
        scaling:
          minInstances: 2
    routes:
      - id: ui
        target: web
        path: /
    publications:
      - name: web-ui
        display:
          title: Web UI
```

`overrides.<env>` may contain `compute`, `resources`, `routes`, `publications`,
and `env`. `compute` and `resources` merge by name, `env` shallow-merges,
`routes` replace the base route collection, and publications merge by `name`.
The merged manifest is validated again.

## Direct deploy

Direct deploy commands are authoring conveniences:

```bash
takos deploy image ghcr.io/acme/api@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef --port 8080
```

They compile to a generated public manifest, AppSpec, EnvSpec, and PolicySpec
before resolution. They do not bypass the Deployment lifecycle (resolve → apply
→ GroupHead advance). The generated manifest carries:

```yaml
overrides:
  takos.directDeploy:
    generated: true
    inputKind: image
```

For image direct deploys, PaaS uses `port: 8080` when the caller does not pass
an explicit port. This default is only for generated direct deploy manifests;
normal `.takos/app.yml` service and attached-container entries must declare
`port`.

If a group's `GroupHead` already points to a Deployment whose
`Deployment.input.manifest_snapshot` came from a non-generated manifest, direct
deploy is blocked unless the caller explicitly opts into mutating that
manifest-managed group.
