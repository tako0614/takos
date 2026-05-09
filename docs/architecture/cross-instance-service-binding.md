# Cross-instance service binding

外部 takosumi instance (別 deployment / 別 operator / 別 cloud) の service へ
manifest の `imports[].service` (**forward 3-level dotted service identifier**)
と `serviceResolvers[]` (operator-injected anchor URL) を介して接続するための
mechanism です。**consumer manifest には service identifier のみを記述し、
endpoint URL を書きません**。 kernel は anchor 経由で provider-signed
`ServiceDescriptor` を fetch し、 signature verify + contract version pinning

- descriptor digest pin + audit append のみ担当します。

これにより、 takosumi-cloud (Takosumi Accounts / billing / dashboard) や 他
service は **service identifier として location-independent に参照** され、 特定
hostname (例 `accounts.takosumi.cloud`) への lock-in が architectural レベル
で排除されます。

## このページで依存してよい範囲

- service identifier の概念 (forward 3-level
  dotted、`<ecosystem>.<area>.<function>@<ver>`)
- `ServiceDescriptor` / `CrossInstanceShare` record の役割
- provider 側 / consumer 側 / anchor の責務分離
- kernel が service registry を持たない原則 (kernel-pure 維持)
- 実装状況: consumer 側 manifest validation / anchor fetch / Ed25519 signature
  verify / descriptor digest pinning は mainline 実装済み。provider publish
  automation、cache refresh / revoke、installer-only placeholder materialization
  は別 track。

## このページで依存してはいけない範囲

- service identifier format の formal grammar
  ([Service identifier spec](/reference/service-identifier-spec))
- `imports[]` / `serviceResolvers[]` field 詳細
  ([Manifest spec](/reference/manifest-spec))
- AppBinding kind の field 詳細 ([Binding catalog](/reference/binding-catalog))
- takosumi-cloud distribution の具体 manifest
  ([takosumi-cloud](./takosumi-cloud.md))
- v1.0 core invariants の formal text
  ([Core contract v1.0](/takosumi/core/01-core-contract-v1.0))

## なぜ cross-instance binding が必要か

Installable App Model では、 takosumi-cloud distribution (Takosumi Accounts /
billing / dashboard / install UI / anchor) を **operator が任意の hostname で
deploy できる** ことが essential 要件です。同じ distribution を
`accounts.example.com` / `accounts.acme.corp` / `accounts.takosumi.cloud`
などどの hostname に置いても、 consumer 側 (Takos / 第三者 app) は **同じ
manifest** で接続できなければなりません。

旧モデル (consumer manifest に `OIDC_ISSUER_URL=https://accounts.takosumi.cloud`
を書く) は、 hostname を直接 import 側に固定するため:

- operator が provider を切り替えるたび、 全 consumer manifest を grep & replace
- canonical hostname (`accounts.takosumi.cloud`) が docs / 例文 / 設計の暗黙
  default として定着し、 architectural lock-in を生む
- service contract version 整合 / TTL / revoke / refresh が operator 自身の
  管理になり、 kernel が helper を持たない

cross-instance binding primitive はこれを解決します。

## 設計の核

### 1. Provider 側 (例: takosumi-cloud を deploy する operator)

provider manifest が `services[]` で service set を export 宣言します:

```yaml
apiVersion: "1.0"
kind: Manifest
namespace: takosumi

resources:
  - shape: web-service@v1
    name: account-auth
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takosumi/accounts@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }

services:
  - id: takosumi.account.auth # forward 3-level dotted service id
    version: v1 # contract semver
    contract: takosumi.account.auth@v1
    endpoints: # operator URL で deploy 時 resolve
      - role: oidc-issuer
        url: ${ref:account-auth.url}
        path: /
      - role: install-launch
        url: ${ref:account-auth.url}
        path: /v1/install/launch
    metadata:
      pairwiseSubjectMode: true
    publish:
      anchors:
        - https://anchor.example.com/v1/services/
      signing:
        privateKeyRef: provider-signing-key
```

provider が deploy 時に `${ref:<resource>.url}` で endpoint URL を
operator-chosen hostname で resolve し、 anchor service に **provider-signed
`ServiceDescriptor`** を publish します。

### 2. Consumer 側 (例: Takos / 別 takosumi instance / 第三者 app)

consumer manifest は anchor URL 1 個と service identifier のみを書きます:

```yaml
apiVersion: "1.0"
kind: Manifest
namespace: my-takos

serviceResolvers: # consumer は anchor を pin (1 hostname のみ)
  - kind: anchor
    url: https://my-anchor.example.com/v1/services/
    publicKey: BASE64_ED25519_PUBLIC_KEY

imports:
  - alias: account-auth
    service: takosumi.account.auth@v1 # service identifier のみ、 endpoint URL なし
    refreshPolicy:
      kind: ttl
      ttl: 300s

resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/takos/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
        OIDC_INSTALL_LAUNCH_URL: ${imports.account-auth.endpoints.install-launch.url}
```

**critical**: consumer manifest に `accounts.example.com` のような endpoint
hostname を書く箇所はありません。 hostname dependency は anchor URL 1
箇所に集中し、 operator はそれを差し替えるだけで provider を切り替えられます。

### 3. Resolution flow (kernel apply 時)

```text
1. consumer が deployment を kernel に apply
2. kernel が manifest.imports[] を走査
3. 各 import について manifest.serviceResolvers[].url に
     GET /v1/services/<service-id>@<version>
4. anchor が provider-signed ServiceDescriptor を返す
5. kernel が:
     - signature verify (anchor pinned publicKey で)
     - contract version match check
     - descriptor digest / provider instance / expiry を resource metadata に pin
     - CrossInstanceShare record を in-memory resolution evidence として作る
6. resource spec の `${imports.<alias>.endpoints.<role>.<field>}` を解決する
7. `${bindings.*}` / `${secrets.*}` など installer-only placeholder は kernel
   到達前に materialize 済みでなければならない。current takosumi-git は未解決なら
   compile error にする
```

### 4. kernel-pure を維持する境界

| kernel が touch するもの                         | kernel が touch しないもの                                |
| ------------------------------------------------ | --------------------------------------------------------- |
| anchor URL HTTP GET (1 fetch / refresh interval) | 実 service-to-service 通信 (consumer plugin / app の責務) |
| `ServiceDescriptor` signature verify             | DNS / TLS / 証明書管理 (operator の責務)                  |
| contract version pinning + descriptor digest pin | anchor 内部 implementation (anchor は別 service)          |
| `CrossInstanceShare` audit append                | service registry そのもの (kernel は持たない)             |
| TTL refresh schedule (metadata only)             | 実 token refresh / authentication (OIDC consumer plugin)  |

これにより kernel は **service registry を持たない stateless manifest applier
のまま**です。anchor は operator が inject する 1 個の URL であり、 kernel
内部に service catalog を保持しません。

## 既存概念との関係

| 既存 / 周辺概念                             | Cross-instance import での扱い                                           |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| `services[]`                                | provider 側の cross-instance service export                              |
| `imports[]`                                 | consumer 側の service identifier reference                               |
| `serviceResolvers[]`                        | operator が pin する anchor resolver                                     |
| `CrossInstanceShare`                        | instance 間 resolution evidence / audit record                           |
| AppInstallation export (Layer A, Phase 1.6) | self-host への持ち出し。service id import とは orthogonal                |
| `accounts.takosumi.cloud` canonical         | 不要。service id `takosumi.account.auth@v1` と anchor URL だけで参照する |

## Anchor service

anchor は **web service** で、 service registry / publication relay
を提供します。

- anchor 自身も `takosumi.platform.anchor@v1` で service identifier として
  expose 可能 (ただし bootstrap は consumer manifest の anchor URL pin)
- federation は anchor 間 peering で実装可能 (Phase 2.x 検討対象)
- provider が `publish` で signed descriptor を upsert
- consumer が `resolve` で fetch する

## Audit / TTL / Revoke

- `CrossInstanceShare.auditTrail` は append-only hash chain (既存 audit 体系
  と統合)
- TTL refresh は kernel scheduler が manage (refresh は metadata 更新のみ、 実
  token refresh は consumer plugin)
- revoke は AppGrant revoke 経路と統合
  ([AppInstallation 台帳](./app-installation.md) と一貫した revoke flow)

## Failure modes

| Failure                                                     | kernel 側 behavior                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| anchor unreachable                                          | 現状は apply reject。cached descriptor 継続は refresh/revoke track                                                    |
| 期限切れ + anchor unreachable                               | apply reject                                                                                                          |
| signature verify failure                                    | apply reject                                                                                                          |
| contract version skew (manifest `@v1` ≠ descriptor version) | apply reject                                                                                                          |
| descriptor missing endpoint role                            | provider descriptor は通るが、consumer が要求した role の materialization は installer/account-plane 側で reject する |

## Implementation status

cross-instance service binding primitive は v1.x foundation として mainline に
入り始めています。現状の実装済み範囲:

- core record `ServiceDescriptor` / `CrossInstanceShare`
- service identifier parser / contract validator
- manifest schema 拡張 (`namespace` / `services[]` / `imports[]` /
  `serviceResolvers[]` field、 全て additive で backward-compat)
- public deploy route の anchor fetch / Ed25519 signature verify / contract
  match / expiry check / resource metadata pin
- resource spec placeholder `${imports.<alias>.endpoints.<role>.<field>}` の
  resolution

未実装または別 track:

- provider 側 `services[].publish` automation と anchor upsert service
- cached descriptor refresh / revoke / degraded continuation
- failed verification attempt の durable audit append
- installer-only placeholder materialization (`${bindings.*}` / `${secrets.*}`)

takosumi-cloud distribution が forward 3-level dotted で 5 services
(`takosumi.account.auth@v1` / `takosumi.account.billing@v1` /
`takosumi.dashboard.web@v1` / `takosumi.platform.deploy@v1` /
`takosumi.platform.anchor@v1`) を export する設計の具体は
[takosumi-cloud](./takosumi-cloud.md) を参照。

## 関連ページ

- [Installable App Model](./installable-app-model.md)
- [Takosumi Accounts](./takosumi-accounts.md)
- [AppInstallation 台帳](./app-installation.md)
- [Service identifier spec](/reference/service-identifier-spec)
- [Manifest spec](/reference/manifest-spec)
- [Binding catalog](/reference/binding-catalog)
- [takosumi-cloud distribution](./takosumi-cloud.md)
- [Core contract v1.0 (cross-instance invariants)](/takosumi/core/01-core-contract-v1.0)
