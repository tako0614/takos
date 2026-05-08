# Service identifier spec

cross-instance service binding で使う **service identifier** の formal spec
です。 service identifier は consumer manifest の `imports[].service` と
provider manifest の `services[].id` で参照される location-independent な
service 名で、 forward 3-level dotted format (`<ecosystem>.<area>.<function>@<version>`)
を取ります。

設計全体は
[architecture/cross-instance-service-binding](/architecture/cross-instance-service-binding)、
具体的な distribution 例は
[architecture/takosumi-cloud](/architecture/takosumi-cloud) を参照。

## このページで依存してよい範囲

- service identifier の grammar (forward 3-level dotted)
- `ServiceDescriptor` / `CrossInstanceShare` / `EndpointRoleResolved` の
  TypeScript record schema
- 命名 convention (3 階層を超える case の guidance)
- semver 互換性 policy

## このページで依存してはいけない範囲

- 設計の motivation / なぜこの primitive が必要か
  ([cross-instance-service-binding](/architecture/cross-instance-service-binding))
- takosumi-cloud distribution の具体 service set
  ([takosumi-cloud](/architecture/takosumi-cloud))
- manifest top-level field 詳細
  ([manifest-spec](./manifest-spec))
- binding kind `service.import@v1` の field 詳細
  ([binding-catalog](./binding-catalog))

## 1. Service identifier grammar

```text
service-identifier = <ecosystem> "." <area> "." <function> "@" <version>

ecosystem = lowercase-id              ; "takosumi" / "takos" / 3rd-party identifier
area      = lowercase-id              ; "account" / "dashboard" / "platform" / "app"
function  = lowercase-id              ; "auth" / "billing" / "web" / "deploy"
version   = "v" digit+ [ "-" lowercase-id ]
                                      ; 例: "v1" / "v2-beta"

lowercase-id = lowercase-letter (lowercase-letter | digit | "-")*
```

例:

```text
takosumi.account.auth@v1
takosumi.account.billing@v1
takosumi.dashboard.web@v1
takosumi.platform.deploy@v1
takosumi.platform.anchor@v1
takos.app.public-api@v1
acme.identity.workforce-sso@v2-beta
```

## 2. 命名 convention

3 level 構造:

| Level | 役割 | 例 |
| --- | --- | --- |
| **ecosystem** | identifier の root namespace。 organization / product family ごとに 1 つ | `takosumi` (canonical) / `takos` / 3rd-party identifier |
| **area** | 機能領域。 `account` / `dashboard` / `platform` 等 | `account` / `dashboard` / `platform` / `app` |
| **function** | 具体 service 機能 | `auth` / `billing` / `web` / `deploy` |

### 3 階層を超える case

3 階層を超えた構造 (例 `takosumi.platform.subsystem.subservice`) を要する
場合、 area / function を統合して 3 階層に収める guidance を取ります:

| NG | OK |
| --- | --- |
| `takosumi.platform.deploy.api` | `takosumi.platform.deploy@v1` (deploy が役割含む) |
| `takosumi.account.auth.oidc.passkey` | `takosumi.account.auth@v1` (passkey は internal) |
| `takosumi.app.notification.web` | `takos.app.notification@v1` (ecosystem を切って 3 階層化) |

3 階層は service identifier の **identity** を担うのみで、 内部 method 列は
endpoint role (`endpoints[].role`) で表現します。 階層を増やさず role list を
拡張するのが正しい extension 方向です。

## 3. Version policy (semver-lite)

| 項目 | rule |
| --- | --- |
| version field | `v<major>` 形式必須。 例 `v1` / `v2`。 `v1.2.3` のように patch / minor を expose しない |
| stable / pre-release | stable は `v1` / `v2`、 pre-release は `v2-beta` / `v3-rc` 等 hyphen suffix |
| breaking change | major bump (`v1` → `v2`)。 同じ service id で異なる major は別 service として扱う |
| additive change | 同 major で endpoint role 追加 / metadata 追加可、 既存 role 削除は breaking |
| descriptor 内 detail version | `ServiceDescriptor.version` は manifest の `service: ...@v1` と完全一致しなければならない (mismatch は apply reject、 invariant 17) |

## 4. ServiceDescriptor record

```ts
type ServiceDescriptor = {
  id: string;                          // 例: "takosumi.account.auth"
  version: string;                     // 例: "v1"
  contract: string;                    // 例: "takosumi.account.auth@v1"
  endpoints: EndpointRoleResolved[];   // provider deploy 時に operator URL で resolved
  metadata: Record<string, unknown>;   // pairwiseSubjectMode 等
  signature: string;                   // provider's private key で署名 (Ed25519)
  publishedAt: string;                 // ISO 8601 timestamp
  expiresAt: string;                   // ISO 8601 timestamp (TTL)
  providerInstance: string;            // provider deployment id (audit 用)
};

type EndpointRoleResolved = {
  role: string;                        // 例: "oidc-issuer" / "install-launch" / "billing-webhook"
  url: string;                         // operator が deploy 時に injected
  path: string;                        // 例: "/" / "/v1/install/launch"
};
```

field 詳細:

| field | 説明 |
| --- | --- |
| `id` | forward 3-level dotted (version 抜き) の service identifier |
| `version` | semver-lite (`v1` / `v2-beta`) |
| `contract` | `<id>@<version>` を 1 string で表現 |
| `endpoints[]` | provider deploy 時に operator URL で resolved した endpoint role list。 consumer 側 binding が `${imports.<alias>.endpoints.<role>.url}` で参照する |
| `metadata` | service-specific な capability flag (例 `pairwiseSubjectMode: true`)。 consumer は `${imports.<alias>.metadata.<key>}` で参照可 |
| `signature` | provider の private key で descriptor 全体を Ed25519 署名。 anchor pinned `publicKey` で kernel が verify (invariant 16) |
| `publishedAt` / `expiresAt` | TTL window (ISO 8601 / RFC 3339) |
| `providerInstance` | provider deployment id (audit 用、`CrossInstanceShare` audit trail に記録) |

## 5. CrossInstanceShare record

```ts
type CrossInstanceShare = {
  id: string;
  serviceId: string;                    // 例: "takosumi.account.auth@v1"
  toDeploymentId: string;                // import 側 Deployment id
  resolvedDescriptor: ServiceDescriptor; // anchor 経由 fetch、 descriptor_closure に pin
  resolvedAt: string;                    // ISO 8601 timestamp
  refreshPolicy: TTLRefresh | EventDrivenRefresh;
  revokedAt?: string;
  auditTrail: AuditEvent[];              // append-only hash chain
};

type TTLRefresh = {
  kind: "ttl";
  ttl: string;                           // 例: "300s" / "1h"
};

type EventDrivenRefresh = {
  kind: "event-driven";
  triggers: EventTrigger[];
};

type AuditEvent = {
  at: string;                            // ISO 8601 timestamp
  kind: "resolved" | "verified" | "rejected" | "revoked" | "refreshed";
  detail: Record<string, unknown>;
  prevHash: string;                      // 前 event の hash
  hash: string;                          // この event の hash
};
```

`CrossInstanceShare` は core contract の cross-instance resolution evidence
record です。`SpaceExportShare` (同 instance 内 Space 間 publication share) の
sibling primitive で、cross-instance scope であることが識別子です。

## 6. Anchor URL contract

`serviceResolvers[].url` は HTTP(S) endpoint で、 以下 semantics を持ちます:

```text
GET <anchor-url>/<service-id>@<version>
  Accept: application/json

Response:
  200 OK
    Content-Type: application/json
    Body: ServiceDescriptor (JSON)
  404 Not Found
    body: { error: "service-not-found", id, version }
  410 Gone
    body: { error: "service-revoked", id, version, revokedAt }
```

anchor は provider が `publish` で signed descriptor を upsert したものを
relay します。 anchor 自身は signature を生成しません (provider's privateKey で
署名されたまま relay)。

## 7. Backward compatibility

manifest schema 拡張 (`namespace` / `services[]` / `imports[]` /
`serviceResolvers[]`) は **additive** で既存 manifest と backward-compat。
`imports[]` を持たない manifest は従来と同じ apply 経路で処理されます
(cross-instance binding を使わない deployment は影響なし)。

現状の mainline は consumer 側の manifest validation / anchor fetch /
signature verify / descriptor pinning を実装済みです。provider publish
automation、descriptor cache refresh / revoke、app-level placeholder
materialization は takosumi-cloud / takosumi-git 側の継続 work です。

## 関連ページ

- [Cross-instance service binding (architecture)](/architecture/cross-instance-service-binding)
- [takosumi-cloud distribution](/architecture/takosumi-cloud)
- [Manifest spec](./manifest-spec)
- [Binding catalog](./binding-catalog)
- [Glossary](./glossary)
- [Core contract v1.0 (invariants 16/17/18)](/takosumi/core/01-core-contract-v1.0)
