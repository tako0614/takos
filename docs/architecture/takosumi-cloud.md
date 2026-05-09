# takosumi-cloud distribution

takosumi-cloud は **forward 3-level dotted service identifier で 5 services を
expose する distribution** です。 Takosumi Accounts / billing / AppInstallation
ledger / dashboard / install UI / anchor を 1 つの distribution として配布し、
operator が任意の hostname で deploy します。 consumer (Takos product / 第三者
app / 別 takosumi instance) は **anchor URL を 1 個 pin、 service identifier
経由で `imports[].service` で外部接続** するため、 特定 hostname への lock-in
は無く、 operator が任意の hostname で deploy できます。

設計全体は
[cross-instance-service-binding](./cross-instance-service-binding.md)、 service
identifier formal spec は
[reference/service-identifier-spec](/reference/service-identifier-spec)、
Takosumi Accounts の責務は [takosumi-accounts](./takosumi-accounts.md) を参照。

## このページで依存してよい範囲

- takosumi-cloud distribution が export する 5 services
- 各 service の identifier / endpoint role / metadata
- provider 側 manifest sample
- consumer 側 manifest sample
- AppInstallation / runtime mode との関係 (high-level)

## このページで依存してはいけない範囲

- service identifier format の formal grammar
  ([service-identifier-spec](/reference/service-identifier-spec))
- AppInstallation 台帳 schema ([app-installation](./app-installation.md))
- billing 主体 / Stripe 連携の詳細 ([Takosumi Cloud billing](/platform/billing))
- runtime mode (shared-cell / dedicated / self-hosted) の switching 手順
  ([runtime-modes](./runtime-modes.md))
- installer pipeline の 13 step ([installer-pipeline](./installer-pipeline.md))

## 1. takosumi-cloud が export する 5 services

| service identifier            | 役割                                            | endpoint roles                            | metadata                       |
| ----------------------------- | ----------------------------------------------- | ----------------------------------------- | ------------------------------ |
| `takosumi.account.auth@v1`    | OIDC issuer / install launch / pairwise subject | `oidc-issuer` / `install-launch` / `jwks` | `pairwiseSubjectMode: true`    |
| `takosumi.account.billing@v1` | Stripe webhook / line-item / subscription       | `webhook` / `subscription-api`            | `stripeBillingSupported: true` |
| `takosumi.dashboard.web@v1`   | install dashboard / web UI                      | `web` / `install-preview`                 | —                              |
| `takosumi.platform.deploy@v1` | deploy plane / runtime mode switching           | `deploy-api` / `materialize` / `export`   | —                              |
| `takosumi.platform.anchor@v1` | service registry (recursive)                    | `resolver`                                | —                              |

これらは **forward 3-level dotted format**
(`<ecosystem>.<area>.<function>@<version>`) で表現され、 consumer manifest
からは hostname なしで参照されます。

## 2. Provider 側 manifest sample

operator が takosumi-cloud distribution を deploy する manifest 例:

```yaml
apiVersion: "1.0"
kind: Manifest
namespace: takosumi

resources:
  - shape: web-service@v1
    name: account-auth
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takosumi/cloud-account-auth@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: web-service@v1
    name: account-billing
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takosumi/cloud-account-billing@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: web-service@v1
    name: dashboard-web
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takosumi/cloud-dashboard@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: web-service@v1
    name: platform-deploy
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takosumi/cloud-platform-deploy@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

  - shape: web-service@v1
    name: platform-anchor
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takosumi/cloud-anchor@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

services:
  - id: takosumi.account.auth
    version: v1
    contract: takosumi.account.auth@v1
    endpoints:
      - role: oidc-issuer
        url: ${ref:account-auth.url}
        path: /
      - role: install-launch
        url: ${ref:account-auth.url}
        path: /v1/install/launch
      - role: jwks
        url: ${ref:account-auth.url}
        path: /.well-known/jwks.json
    metadata:
      pairwiseSubjectMode: true
    publish:
      anchors:
        - ${ref:platform-anchor.url}
      signing:
        privateKeyRef: provider-signing-key

  - id: takosumi.account.billing
    version: v1
    contract: takosumi.account.billing@v1
    endpoints:
      - role: webhook
        url: ${ref:account-billing.url}
        path: /v1/stripe/webhook
      - role: subscription-api
        url: ${ref:account-billing.url}
        path: /v1/subscriptions
    metadata:
      stripeBillingSupported: true
    publish:
      anchors:
        - ${ref:platform-anchor.url}
      signing:
        privateKeyRef: provider-signing-key

  - id: takosumi.dashboard.web
    version: v1
    contract: takosumi.dashboard.web@v1
    endpoints:
      - role: web
        url: ${ref:dashboard-web.url}
        path: /
      - role: install-preview
        url: ${ref:dashboard-web.url}
        path: /install/preview
    publish:
      anchors:
        - ${ref:platform-anchor.url}
      signing:
        privateKeyRef: provider-signing-key

  - id: takosumi.platform.deploy
    version: v1
    contract: takosumi.platform.deploy@v1
    endpoints:
      - role: deploy-api
        url: ${ref:platform-deploy.url}
        path: /v1/deployments
      - role: materialize
        url: ${ref:platform-deploy.url}
        path: /v1/materialize
      - role: export
        url: ${ref:platform-deploy.url}
        path: /v1/export
    publish:
      anchors:
        - ${ref:platform-anchor.url}
      signing:
        privateKeyRef: provider-signing-key

  - id: takosumi.platform.anchor
    version: v1
    contract: takosumi.platform.anchor@v1
    endpoints:
      - role: resolver
        url: ${ref:platform-anchor.url}
        path: /v1/services/
```

operator が deploy 時に各 resource の output URL (operator-chosen hostname) で
endpoint が resolve され、 anchor (`${ref:platform-anchor.url}`) に
provider-signed descriptor が publish されます。 hostname は operator の判断
(`accounts.example.com` / `accounts.acme.corp` など何でも可) で、 service
identifier (`takosumi.account.auth@v1`) は不変です。

## 3. Consumer 側 (Takos product) manifest sample

Takos product / 第三者 app は anchor URL を 1 個 pin、 service identifier 経由で
takosumi-cloud services を import します:

```yaml
apiVersion: "1.0"
kind: Manifest
namespace: my-takos

serviceResolvers:
  - kind: anchor
    url: https://my-anchor.example.com/v1/services/
    publicKey: BASE64_ED25519_PUBLIC_KEY

imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
    refreshPolicy:
      kind: ttl
      ttl: 300s

  - alias: account-billing
    service: takosumi.account.billing@v1
    refreshPolicy:
      kind: ttl
      ttl: 300s

resources:
  - shape: web-service@v1
    name: takos-api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takos/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
        OIDC_INSTALL_LAUNCH_URL: ${imports.account-auth.endpoints.install-launch.url}
        OIDC_JWKS_URL: ${imports.account-auth.endpoints.jwks.url}
        BILLING_WEBHOOK_URL: ${imports.account-billing.endpoints.webhook.url}
        BILLING_SUBSCRIPTION_API_URL: ${imports.account-billing.endpoints.subscription-api.url}
```

operator が provider を切り替える場合 (例 managed → self-hosted) は
`serviceResolvers[].url` を 1 行差し替えるだけで完了します。 endpoint URL を
consumer manifest に書く箇所が無いため、 grep & replace は不要です。

## 4. AppInstallation との関係

AppInstallation 台帳 ([app-installation](./app-installation.md)) で declare
される `AppBinding` (`identity.oidc@v1` / `install-launch-token@v1` /
database / object-store / domain / deploy-intent) と billing service import は、
cross-instance import 経由で resolve された descriptor を内部的に参照します:

```text
AppInstallation.bindings[]
  ├── identity.oidc@v1
  │     issuerUrl ←──── ${imports.account-auth.endpoints.oidc-issuer.url}
  │     jwksUrl   ←──── ${imports.account-auth.endpoints.jwks.url}
  └── install-launch-token@v1
        launchUrl ←──── ${imports.account-auth.endpoints.install-launch.url}

AppInstallation.serviceImports[]
  └── account-billing: takosumi.account.billing@v1
        subscriptionApiUrl ←──── ${imports.account-billing.endpoints.subscription-api.url}
        webhookUrl         ←──── ${imports.account-billing.endpoints.webhook.url}
```

つまり AppInstallation 側は service identifier の存在を意識せず、 binding
catalog の既存 6 kinds と serviceImports をそのまま使います。 billing は
AppBinding kind ではなく Takosumi Accounts billing / ledger の責務です。
cross-instance binding は
**resolution layer** で挿入される拡張で、 AppInstallation contract には
影響しません。

## 5. Runtime mode との関係

3 runtime mode (shared-cell / dedicated / self-hosted) は cross-instance binding
と orthogonal です:

| Mode        | takosumi-cloud との関係                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| shared-cell | takos-cloud-managed anchor を pin (operator は default URL を採用)                                        |
| dedicated   | dedicated runtime も同 anchor URL で接続 (内部 binding は不変)                                            |
| self-hosted | operator が自前 anchor を deploy、 consumer manifest の `serviceResolvers[].url` を自前 anchor に切り替え |

self-host への移行は AppInstallation export
([Layer A, Phase 1.6](./runtime-modes.md)) と直交し、 service identifier import
は変更不要です。 anchor URL のみが operator-chosen で、 takosumi-cloud
distribution は同じ binary / 同じ service identifier set を維持します。

## 6. Cross-instance binding status

5 services の identifier 設計は docs / contract に反映済みで、kernel 側は
consumer manifest の `imports[]` / `serviceResolvers[]` validation、anchor
resolution、signature verify、descriptor pin metadata を実装済みです。
takosumi-cloud distribution 側の provider publish automation / anchor upsert /
cache refresh / revoke は継続 work です。移行は manifest schema が additive な
ため backward-compat。

current status の全体像は [Takosumi current state](/takosumi/current-state) と
[Manifest spec](/reference/manifest-spec) を参照。

## 関連ページ

- [Cross-instance service binding (canonical 設計)](./cross-instance-service-binding.md)
- [Service identifier spec](/reference/service-identifier-spec)
- [Takosumi Accounts](./takosumi-accounts.md)
- [AppInstallation 台帳](./app-installation.md)
- [Runtime Modes](./runtime-modes.md)
- [Installer Pipeline](./installer-pipeline.md)
- [Manifest spec](/reference/manifest-spec)
- [Binding catalog](/reference/binding-catalog)
- [Takosumi Cloud billing](/platform/billing)
