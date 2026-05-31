# アプリメタデータの境界

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: AppSpec、Deployment output、Takos app metadata
> の境界。

## Current Contract

| 種別                                    | 所有者                                                                 | kernel に渡る形                       |
| --------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| HTTP workload / ingress                 | worker output + adopted gateway descriptor                             | source ref + gateway descriptor spec  |
| AppSpec identity metadata               | `.takosumi.yml` `metadata`                                             | AppSpec の一部として渡る              |
| Component output (DB / blob 等)         | `.takosumi.yml` `components.*.connect` consumer refs                   | component output + material kind      |
| Operator/account-plane output (OIDC 等) | takosumi-cloud の platform service (e.g. `identity.primary.oidc`)      | platform service                      |
| App subscription                        | `.takosumi.yml` `components.*.listen`                                  | env / secret refs                     |
| MCP endpoint metadata                   | Takos registry / app catalog metadata outside AppSpec                  | 渡らない                              |
| File handler metadata                   | Takos app catalog / runtime registry                                   | 渡らない                              |
| Launcher metadata                       | Takos Store + gateway descriptor / publication metadata                | 渡らない                              |

Takosumi installer は AppSpec を読み、AppSpec identity metadata、`connect`
binding、`listen` binding、root `publish` declaration、kind-owned gateway `spec`、source reference を記録し、
selected ingress binding に渡せる Deployment record を残します。Takos app layer はその outputs を使って MCP
registry、file handler catalog、launcher entry を materialize します。

## AppSpec connect / listen

`connect` は同じ AppSpec 内の component output を受け取り、`listen` は
operator-to-app の platform service や external publication を受け取る primitive
です。root `publish` は Installation output を Space-visible inventory に出したい
ときだけ使います。

```yaml
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
    connect:
      db:
        output: db.connection
        inject: secret-env
        prefix: DB
    listen:
      oidc:
        path: identity.primary.oidc
        kind: identity.oidc@v1
        inject: secret-env
        prefix: OIDC
        required: true
  db:
    kind: postgres
  public:
    kind: gateway
    connect:
      upstream:
        output: web.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
          host: app.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

`identity.primary.oidc` は takosumi-cloud (operator account plane、リファレンス実装: Takosumi Accounts) の external
publication で、`listen` 側 component には per-Installation OIDC client
が発行されます。runtime からは `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
`OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` として見えます。同様に
`db.connection` が materialize する DB の connection string は `DB_*` env として
`connect` した `web` 側に inject されます。

## Responsibility Split

Takosumi kernel は AppSpec evaluation、Installation / Deployment record、
operator-selected apply を担当します。Takosumi Accounts は OIDC issuer、 OIDC
client provisioning、billing owner、account-plane ledger を担当します。 Takos
Worker/domain layer は app catalog / Store / launcher catalog、MCP registry、 file handler
registry の意味を担当します。 OIDC のような operator-owned surface は、external
publication を app が `listen` する形で受け取ります。
