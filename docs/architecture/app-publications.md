# アプリメタデータの境界

> このページでわかること: AppSpec、Deployment output、Takos app metadata の境界。

## Current Contract

| 種別 | 所有者 | kernel に渡る形 |
| --- | --- | --- |
| HTTP workload / ingress | `.takosumi.yml` `components` | compiled worker / route operation |
| App install metadata | `.takosumi.yml` `metadata` | 渡らない |
| Component output (DB / blob 等) | `.takosumi.yml` `components.*.publish` | namespace path + payload schema |
| Operator/account-plane output (OIDC 等) | takosumi-cloud が publish する namespace (e.g. `operator.identity.oidc`) | namespace export |
| App subscription | `.takosumi.yml` `components.*.listen` | compiled env / secret refs |
| MCP endpoint metadata | Takos registry (= AppSpec の worker `spec` 内 convention で表現)     | 渡らない |
| File handler metadata | Takos app catalog / runtime registry                                  | 渡らない |
| Launcher metadata     | Takos Store + worker `spec.routes` / namespace pub (Wave J 以降)      | 渡らない |

Takosumi installer は AppSpec を読み、 build artifact、 `publish` 宣言、 `listen`
subscription、 route output を materialize して Deployment record を残します。 Takos app
layer はその outputs を使って MCP registry、 file handler catalog、 launcher entry を
materialize します。

## namespace pub/sub

`publish` / `listen` は component 間および operator-to-app の dependency の public
primitive です。

```yaml
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    listen:
      operator.identity.oidc:
        as: env
      example.app.db:
        as: env
        prefix: DB_
  db:
    kind: postgres
    publish:
      - example.app.db
```

`operator.identity.oidc` は takosumi-cloud (operator account plane) が provider として
publish する namespace で、 listen 側 component には per-Installation OIDC client が
発行されます。 runtime からは `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
`OIDC_REDIRECT_URIS` として見えます。 同様に `db` component が publish する DB の
connection string は `DB_*` env として `web` 側に inject されます。

## Kernel Non-Responsibilities

kernel は次を行いません。

- OAuth / OIDC issuer を提供する
- OIDC client を発行する
- billing owner になる
- app catalog / Store / launcher catalog を所有する
- MCP registry や file handler registry の意味を解釈する

これらは Takosumi Accounts (= takosumi-cloud)、 takosumi installer、 または Takos app
layer の責務です。 OIDC のように operator 側が provider として振る舞う surface は、
operator が namespace を `publish` し、 app が `listen` する形で受け取ります。
