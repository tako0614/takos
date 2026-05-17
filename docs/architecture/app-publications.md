# アプリメタデータの境界

> このページでわかること: アプリのメタデータと kernel の Shape リソースの境界。

## Current Contract

| 種別 | 所有者 | kernel に渡る形 |
| --- | --- | --- |
| HTTP workload / ingress | `.takosumi.yml` `resources[]` | `worker@v1` / `web-service@v1` / `custom-domain@v1` |
| App install metadata | `.takosumi.yml` | 渡らない |
| OIDC / DB / blob / launch binding | `.takosumi.yml` `bindings:` | compiled env / secret refs |
| MCP endpoint metadata | Takos app catalog / runtime registry | 渡らない |
| File handler metadata | Takos app catalog / runtime registry | 渡らない |
| Launcher metadata | Takos app catalog / Store | 渡らない |
| Operator/account-plane dependency | namespace export + account API | 渡らない |

kernel は compiled Shape manifest を apply し、resource outputs を返します。
Takos app / installer layer はその outputs を使って MCP registry、file handler
catalog、launcher entry を materialize します。

## use edge

`use edge` は account plane の primitive です。`.takosumi.yml` の
`bindings:` で宣言し、Takosumi Accounts / takosumi-git が install pipeline 中に
provision して compiled manifest に反映します。

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
```

`identity.oidc@v1` は per-Installation の OIDC client を発行します。Takos
runtime からは `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URI` として見えます。

## Shape Manifest

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
```

`workflowRef` や `${bindings.*}` / `${secrets.*}` は installer-side authoring
extension です。kernel に届く manifest では解決済みである必要があります。

## Kernel Non-Responsibilities

kernel は次を行いません。

- OAuth / OIDC issuer を提供する
- OIDC client を発行する
- billing owner になる
- app catalog / Store / launcher catalog を所有する
- MCP registry や file handler registry の意味を解釈する

これらは Takosumi Accounts、takosumi-git、または Takos app layer の責務です。
