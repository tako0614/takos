# Takos Deploy v2 v1.0 Authoring Guide

Core is canonical and flat. Users should not have to write the canonical form for every simple app.

This guide defines recommended authoring conveniences and how they expand to canonical AppSpec / EnvSpec before Plan.

## Rule

```text
Authoring form is user-facing.
Canonical form is Plan-facing.
```

Every authoring convenience must expand before Plan. The expansion descriptor/digest must be part of DescriptorClosure.

---

## Container shorthand

Authoring form:

```yaml
components:
  api:
    kind: container
    image: ghcr.io/acme/api@sha256:abc
    port: 8080
```

Canonical expansion:

```yaml
components:
  api:
    contracts:
      runtime:
        ref: runtime.oci-container@v1

      artifact:
        ref: artifact.oci-image@v1
        config:
          image: ghcr.io/acme/api@sha256:abc

      http:
        ref: interface.http@v1
        config:
          port: 8080
```

Plan output should show:

```text
kind: container expanded to:
  runtime.oci-container@v1
  artifact.oci-image@v1
  interface.http@v1
```

---

## JavaScript worker shorthand

Authoring form:

```yaml
components:
  web:
    kind: js-worker
    entry: ./src/index.ts
    build:
      command: pnpm build
      output: ./dist/worker.mjs
```

Canonical expansion:

```yaml
components:
  web:
    contracts:
      runtime:
        ref: runtime.js-worker@v1

      artifact:
        ref: artifact.js-module@v1
        config:
          entry: ./src/index.ts
          build:
            command: pnpm build
            output: ./dist/worker.mjs

      http:
        ref: interface.http@v1
```

---

## Multiple interfaces

Canonical form supports multiple instances of the same contract:

```yaml
components:
  api:
    contracts:
      runtime:
        ref: runtime.oci-container@v1
      artifact:
        ref: artifact.oci-image@v1
        config:
          image: ghcr.io/acme/api@sha256:abc
      publicHttp:
        ref: interface.http@v1
        config:
          port: 8080
      adminHttp:
        ref: interface.http@v1
        config:
          port: 9090

exposures:
  public:
    target:
      component: api
      contract: publicHttp
  admin:
    target:
      component: api
      contract: adminHttp
```

---

## Resource consume

Resource credentials are not publication outputs. Resource access uses ResourceBinding and ResourceAccessPath.

```yaml
components:
  api:
    consumes:
      DATABASE_URL:
        resource: db
        access:
          contract: resource.sql.postgres@v1
          mode: database-url
        inject:
          mode: env
          target: DATABASE_URL

resources:
  db:
    ref: resource.sql.postgres@v1
```

Plan should show a BindingResolutionReport.

---

## Publication consume

Publication does not imply injection. Outputs must be selected explicitly.

```yaml
components:
  web:
    consumes:
      SEARCH_MCP:
        publication: publication:search-agent/search
        outputs:
          url:
            inject:
              mode: env
              target: SEARCH_MCP_URL
```

If a new output is added to the publication, it is not injected into this existing binding.

---

## Built-in credential publication

Credential outputs should use `secret-ref` by default.

```yaml
components:
  web:
    consumes:
      TAKOS_API:
        publication: builtin:takos.api-key@v1
        request:
          scopes:
            - files:read
        outputs:
          endpoint:
            inject:
              mode: env
              target: TAKOS_API_ENDPOINT
          apiKey:
            inject:
              mode: secret-ref
              target: TAKOS_API_KEY
```

Raw env injection of credential output requires explicit contract support, grant, policy, and approval.

---

## Direct deploy

Direct deploy commands are authoring conveniences:

```bash
takos deploy image ghcr.io/acme/api@sha256:abc --port 8080
takos deploy worker ./dist/worker.mjs
```

They must compile into canonical AppSpec / EnvSpec before Plan and must not bypass Plan / Apply / Activation.

If a group is manifest-managed, direct deploy must not silently mutate AppSpec. It must either:

```text
write manifest
create explicit patch
or block with warning
```
