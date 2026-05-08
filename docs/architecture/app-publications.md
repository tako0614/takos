# App Integration Metadata Boundary

このページは、Installable App Model 後の app-facing integration metadata と
binding の境界を定義します。current `.takosumi/manifest.yml` は Shape manifest
であり、top-level `components` / `routes` / `publications` / `bindings` を
受け付けません。

## Current Contract

Takos app が外部へ見せる launcher / MCP / file handler などの metadata は、
takosumi kernel manifest の primitive ではありません。

| 種別                              | 正本                                   | kernel に渡る形                                     |
| --------------------------------- | -------------------------------------- | --------------------------------------------------- |
| HTTP workload / ingress           | `.takosumi/manifest.yml` `resources[]` | `worker@v1` / `web-service@v1` / `custom-domain@v1` |
| App install metadata              | `.takosumi/app.yml`                    | 渡らない                                            |
| OIDC / DB / blob / launch binding | `.takosumi/app.yml` `bindings:`        | compiled env / secret refs                          |
| MCP endpoint metadata             | Takos app catalog / runtime registry   | 渡らない                                            |
| File handler metadata             | Takos app catalog / runtime registry   | 渡らない                                            |
| Cross-instance service dependency | `.takosumi/manifest.yml` `imports[]`   | `imports[]` + `serviceResolvers[]`                  |

kernel は compiled Shape manifest を apply し、resource outputs
を返します。Takos app / installer layer はその outputs を使って MCP
registry、file handler catalog、 launcher entry などの app-facing metadata を
materialize します。

## What Replaced Publications

旧 AppSpec では `publications[]` が route-backed catalog
を表していました。current model では、同じ目的の metadata は owning layer
に分離します。

| 旧用途                          | current の置き場所                                  |
| ------------------------------- | --------------------------------------------------- |
| MCP server publication          | app metadata / MCP registry                         |
| file handler publication        | app metadata / storage file-handler registry        |
| launcher publication            | app metadata / Store / launcher catalog             |
| Takos API key publication       | AppGrant / app-local service credential             |
| OIDC client publication         | `identity.oidc@v1` AppBinding                       |
| resource credential publication | 使用しない。resource output / secret ref で配線する |

MCP / file handler / launcher metadata は deploy target ではなく discovery
surface です。workload 自体は `resources[]` にある `worker@v1` や
`web-service@v1` として deploy し、metadata はその resource output
を参照します。

## AppBinding

`AppBinding` は account plane の primitive です。`.takosumi/app.yml` の
`bindings:` で宣言し、Takosumi Accounts / takosumi-git が install pipeline 中に
provision して compiled manifest に反映します。

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
    allowedScopes: [openid, email, profile]
```

`identity.oidc@v1` は per-AppInstallation の OIDC client を発行します。Takos
runtime からは `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URI` として見えますが、kernel は OIDC client registry
を所有しません。

Binding catalog の正本は [Binding Catalog](/reference/binding-catalog) です。

## Shape Manifest

kernel-bound manifest は resource graph だけを扱います。

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
extension です。kernel に届く manifest では解決済み、または除去済みである必要が
あります。

## Legacy Vocabulary

`publication.mcp-server@v1`、`publication.file-handler@v1`、
`takos.oauth-client`、top-level `bindings[]` は current kernel-bound manifest の
contract ではありません。古い docs から migration するときは次の対応に寄せます。

| legacy term                   | replacement                                           |
| ----------------------------- | ----------------------------------------------------- |
| `publication.mcp-server@v1`   | MCP registry entry backed by resource output          |
| `publication.file-handler@v1` | file handler registry entry backed by resource output |
| `publication.app-launcher@v1` | launcher / Store catalog metadata                     |
| `takos.oauth-client`          | `identity.oidc@v1` AppBinding                         |
| `bindings[].from.publication` | AppBinding materialization or explicit resource refs  |
| `resource.secret@v1`          | installer secret / provider secret ref                |

## Kernel Non-Responsibilities

kernel は次を行いません。

- OAuth / OIDC issuer を提供する
- OIDC client を発行する
- billing owner になる
- app catalog / Store / launcher catalog を所有する
- MCP registry や file handler registry の意味を解釈する
- top-level `publications[]` / `bindings[]` を current manifest に受け付ける

これらは Takosumi Accounts、takosumi-git、または Takos app layer の責務です。
