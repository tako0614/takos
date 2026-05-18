# アプリメタデータの境界

> このページでわかること: AppSpec、Deployment output、Takos app metadata の境界。

## Current Contract

| 種別 | 所有者 | kernel に渡る形 |
| --- | --- | --- |
| HTTP workload / ingress | `.takosumi.yml` `components` | compiled worker / route operation |
| App install metadata | `.takosumi.yml` `metadata` | 渡らない |
| OIDC / DB / blob dependency | `.takosumi.yml` `components.*.use` | compiled env / secret refs |
| MCP endpoint metadata | `.takosumi.yml` `interfaces.mcp` + Takos registry | 渡らない |
| File handler metadata | Takos app catalog / runtime registry | 渡らない |
| Launcher metadata | `.takosumi.yml` `interfaces.launch` + Store | 渡らない |
| Operator/account-plane dependency | namespace export + account API | 渡らない |

Takosumi installer は AppSpec を読み、build artifact、dependency output、OIDC client、
route output を materialize して Deployment record を残します。Takos app layer は
その outputs を使って MCP registry、file handler catalog、launcher entry を
materialize します。

## `use:` edge

`use:` edge は component 間 dependency の public primitive です。

```yaml
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    use:
      auth:
        mount: oidc
      db:
        env: DATABASE_URL
  auth:
    kind: oidc
    redirectPaths:
      - /auth/oidc/callback
  db:
    kind: postgres
```

`mount: oidc` は per-Installation OIDC client を発行します。runtime からは
`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URIS` として見えます。

## Kernel Non-Responsibilities

kernel は次を行いません。

- OAuth / OIDC issuer を提供する
- OIDC client を発行する
- billing owner になる
- app catalog / Store / launcher catalog を所有する
- MCP registry や file handler registry の意味を解釈する

これらは Takosumi Accounts、takosumi installer、または Takos app layer の責務です。
