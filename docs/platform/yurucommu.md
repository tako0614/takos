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
takosumi-git authoring input の `.takosumi/manifest.yml` を併置します。
`.takosumi/app.yml` の app catalog metadata は installer / runtime registry の
surface であり、 kernel manifest の resource spec とは別の層です。

```yaml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp
metadata:
  id: com.yurucommu.app
  name: Yurucommu
  description: Self-hosted ActivityPub community social app for small communities.
  publisher: takos
  homepage: https://github.com/tako0614/yurucommu
source:
  git: https://github.com/tako0614/yurucommu.git
  ref: v1.2.6
entry:
  manifest: .takosumi/manifest.yml
runtime:
  modes:
    - shared-cell
    - dedicated
    - self-hosted
```

`.takosumi/manifest.yml` で宣言される compute artifact は workflow build
output (`dist/takos-worker.js` 等) を `image` / `bundle` として参照します。
takosumi-git が workflow / binding placeholder を解決し、 必要な resource refs
と OIDC client env を workload に materialize します。

## バインディング

yurucommu は `identity.oidc@v1` AppBinding を宣言し、 Takosumi Accounts を OIDC
issuer として使います。 installer (takosumi-git) が installation ごとの OIDC
client を Takosumi Accounts に登録し、 `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
`OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` を runtime に渡します。 redirect URI
は `/api/auth/callback/takos`、 要求する scope は `openid` / `profile` /
`email` です。

ActivityPub actor URL や callback URL など自分の public origin が必要な処理は、
manifest 側で resource output から materialize される `APP_URL` (= 自身の
`web` publication の URL) を使います。

`.takosumi/app.yml` の bindings 宣言 (詳細は
[app.yml spec](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/app-yml-spec.md)
と [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md)
を参照):

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /api/auth/callback/takos
    allowedScopes:
      - openid
      - profile
      - email
    subjectMode: pairwise
  media:
    type: object-store.s3-compatible@v1
    required: true
    plan: standard
    lifecycleDays: 0
  domain:
    type: domain.http@v1
    required: true
    hostname: auto
    tlsMode: auto
  bootstrap:
    type: install-launch-token@v1
    required: true
    consumePath: /api/auth/login/takos
    maxLifetimeSeconds: 300
```

`install:` セクションは `healthcheckPath: /readyz` と
`postInstallLaunchPath: /api/auth/login/takos` を宣言し、 installer は
install 完了直後に launch token を redeem するためにこの path を呼びます。
manifest 側 (`web-service@v1` resource 等) では public origin を resource
output から `APP_URL` に materialize し、 unresolved `${bindings.*}` が残る
場合 takosumi-git は kernel request 前に失敗します。

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
