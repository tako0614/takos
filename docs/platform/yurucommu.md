# yurucommu

> このページでわかること: バンドルアプリ yurucommu の概要。

yurucommu はセルフホスト型の ActivityPub / コミュニティソーシャルアプリです。
新しい Space を作ると自動インストールされます。

## 役割

- app metadata で social / community UI を提供
- **Takosumi Accounts OIDC consumer (`identity.oidc@v1` AppBinding)** で sign-in
  を行う
- ActivityPub federation、posts、media、DM、community 機能を app 側で管理
- sql / object-store / key-value / queue / secret resource を app manifest
  で宣言

## Manifest contract

yurucommu は installer-bound の `.takosumi/app.yml` (InstallableApp v1) と、
takosumi-git authoring input の `.takosumi/manifest.yml` を併置します。launcher
metadata は app catalog / runtime registry の surface であり、kernel manifest の
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

## バインディング

yurucommu は `identity.oidc@v1` AppBinding を宣言し、Takosumi Accounts を OIDC
issuer として使います。installer (takosumi-git) が installation ごとの OIDC
client を Takosumi Accounts に登録し、`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
`OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` を runtime に渡します。redirect URI
は `/auth/oidc/callback`、要求する scope は `openid` / `email` / `profile` です。

同じ worker は自身の `yurucommu-ui` publication を consume し、`outputs.url` を
`APP_URL` として受け取ります。ActivityPub actor URL や callback URL など、自分の
public origin が必要な処理はこの `APP_URL` を使います。

`.takosumi/app.yml` の bindings 宣言例 (詳細は
[app.yml spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
と [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
を参照):

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

manifest 側では public origin を concrete URL または kernel-owned resource
output から `APP_URL` に materialize します。current takosumi-git は Accounts
materialization 後も unresolved `${bindings.*}` が残る場合、kernel request
前に失敗します。

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
        APP_URL: ${ref:web.url}
```

## リソース

バンドルアプリ集合に含まれても特権アプリにはなりません。yurucommu は次の
アプリリソースを持ちます:

- `sql` — アプリ DB と migrations
- `object-store` — メディアストレージ
- `key-value` — アプリ KV
- `queue` — ActivityPub delivery queue と DLQ
- `secret` — 生成される暗号化鍵

そのため、Docs / Excel / Slide よりも preinstall 時のリソース消費が大きく
なります。
