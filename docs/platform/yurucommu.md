# yurucommu

yurucommu は self-hosted ActivityPub / community social app。Takos では default
app distribution の一部として扱い、新規 space に preinstall できる通常の group
として deploy する。

## 役割

- app metadata で social / community UI を提供
- **Takosumi Accounts OIDC consumer (`identity.oidc@v1` AppBinding)** で sign-in
  を行う
- ActivityPub federation、posts、media、DM、community 機能を app 側で管理
- sql / object-store / key-value / queue / secret resource を app manifest
  で宣言

## Manifest contract

yurucommu は installer-bound の `.takosumi/app.yml` (InstallableApp v1) と、
kernel-bound の `.takosumi/manifest.yml` を併置します。launcher metadata は app
catalog / runtime registry の surface であり、kernel manifest の
`publications[]` ではありません。

```yaml
launcher:
  name: yurucommu-ui
  title: Yurucommu
  description: Self-hosted ActivityPub community social
  icon: /icons/yurucommu.svg
  category: social
  url: ${ref:web.url}/
```

`web` resource は workflow build artifact `dist/takos-worker.js` から作られる
compiled artifact を使います。takosumi-git が workflow / binding placeholder を
解決し、必要な resource refs と OIDC client env を workload に materialize
します。

## Consumes

yurucommu は `identity.oidc@v1` AppBinding を declare し、service identifier
`takosumi.account.auth@v1` で解決される Takosumi Accounts を OIDC issuer として
consume する。 installer (takosumi-git) が installation 単位の OIDC client を
Takosumi Accounts に登録し、`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
`OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` を runtime に inject する。redirect
URI は `/auth/oidc/callback`、scope は `openid` / `email` / `profile`
を要求する。

同じ worker は自身の `yurucommu-ui` publication も consume し、`outputs.url` を
`APP_URL` に inject する。ActivityPub actor URL、callback URL、self reference
など app が自分の public origin を必要とする処理はこの `APP_URL` を使う。

`.takosumi/app.yml` の bindings 宣言例
([`reference/app-yml-spec.md`](/reference/app-yml-spec) /
[`reference/binding-catalog.md`](/reference/binding-catalog) を参照)。

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
    allowedScopes:
      - openid
      - email
      - profile
```

manifest 側では public origin を domain binding / resource output から `APP_URL`
に materialize します。

```yaml
resources:
  - shape: web-service@v1
    name: web
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/yurucommu/yurucommu@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        APP_URL: ${bindings.domain.url}
```

## Resources

default app set に含まれても特権 app にはならない。yurucommu は以下を自前の app
resources として持つ。

- `sql`: app database と migrations
- `object-store`: media storage
- `key-value`: app KV
- `queue`: ActivityPub delivery queue と DLQ
- `secret`: generated encryption key

このため、Docs / Excel / Slide より preinstall 時の resource footprint
は大きい。
