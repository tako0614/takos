# Install API

Installable App Model の installation lifecycle を駆動する **Takosumi
Accounts (= takosumi-cloud account plane) が公開する REST API** の仕様です。

このページで依存してよい範囲:

- 5 つの公開 endpoint の HTTP method / path / request body / response shape
- 認証 (Takosumi Accounts session = OIDC bearer / PAT)
- error response の HTTP status と code 形式
- API base URL: `https://api.takosumi.cloud` (互換 alias:
  `https://accounts.takosumi.cloud/api`)

このページで依存してはいけない範囲:

- takosumi-cloud 内部の persistence model: AppInstallation table の column
  名や index は変わりうる。**API の wire shape のみが contract**。
- takosumi kernel API: 本 API は **takosumi kernel を 1 行も触らない**。kernel
  への伝播は takosumi-git が compiled manifest 経由で行う。
- Takosumi Accounts の OIDC issuer 内部実装: token format などは
  [Takosumi Accounts](/architecture/takosumi-accounts) を参照。

## 0. 共通事項

### 0.1 Base URL と version

| 項目                | 値                                                                |
| ------------------- | ----------------------------------------------------------------- |
| canonical base URL  | `https://api.takosumi.cloud`                                      |
| 互換 alias          | `https://accounts.takosumi.cloud/api` (同一 origin cookie 共有用) |
| API version prefix  | `/v1`                                                             |
| Content-Type        | `application/json; charset=utf-8`                                 |
| Date format         | RFC 3339 (`2026-05-07T08:30:00Z`)                                 |

### 0.2 認証

caller は **Takosumi Accounts session** を保持している必要がある。

| 方式                     | header                                          | 用途                                                  |
| ------------------------ | ----------------------------------------------- | ----------------------------------------------------- |
| OIDC bearer              | `Authorization: Bearer <jwt>`                   | 通常の human / app 操作。issuer は service identifier `takosumi.account.auth@v1` (endpoint URL example: `https://accounts.takosumi.cloud`、 anchor 経由 resolve、 operator-injected hostname) |
| Personal Access Token    | `Authorization: Bearer takpat_<base32>`         | takos-cli / 自動化。Takosumi Accounts の PAT          |
| Service-to-service HMAC  | `Authorization: TakosumiHmac key=...,sig=...`  | takosumi-git → takosumi-cloud の internal call (event 投函等) |

token 検証:

- `iss` = `https://accounts.takosumi.cloud`
- `aud` ⊇ `takosumi-cloud-api`
- `exp` 未過、`nbf` 過、`iat` skew ≤ 60s
- `takosumi.account_id` claim を request の **actor account** とする
- `takosumi.role` (`owner` / `admin` / `member` / `viewer`) で権限判定

### 0.3 Idempotency-Key

すべての state-mutating endpoint で `Idempotency-Key` header を受け付ける。
24 時間内に同 key + 同 body で再送した場合は同じ response を返す。body が
異なる場合は `409 idempotency-key-conflict`。

| endpoint                                            | Idempotency-Key |
| --------------------------------------------------- | --------------- |
| `POST /v1/install/preview`                          | optional        |
| `POST /v1/installations`                            | **required**    |
| `POST /v1/installations/{id}/launch-token`          | optional        |
| `POST /v1/installations/{id}/materialize`           | **required**    |
| `POST /v1/installations/{id}/export`                | **required**    |

### 0.4 Error response (Problem Details)

すべてのエラーは RFC 7807 + RFC 9457 互換 (`application/problem+json`):

```json
{
  "type":     "https://errors.takosumi.cloud/<slug>",
  "title":    "Human readable summary",
  "status":   400,
  "detail":   "Concrete description of what failed.",
  "instance": "/v1/installations",
  "code":     "<machine slug, == last segment of type>",
  "requestId":"req_01J...",
  "errors":   [ { "field": "spec.spaceId", "message": "Required" } ],
  "retryAfter": 30
}
```

主要 error code:

| status | code                          | 用途                                                            |
| ------ | ----------------------------- | --------------------------------------------------------------- |
| 400    | `validation-failed`           | request body / query が schema に合わない                       |
| 400    | `mutable-ref-rejected`        | `ref=main` 等の mutable git ref                                 |
| 401    | `unauthenticated`             | bearer なし / 検証失敗                                          |
| 403    | `forbidden`                   | role / scope 不足                                               |
| 403    | `grant-required`              | 必要な AppGrant が無い (= revoke 済)                            |
| 404    | `installation-not-found`      | id 不在 / 別 account のもの                                     |
| 409    | `idempotency-key-conflict`    | 同 key 別 body                                                  |
| 409    | `state-conflict`              | 状態遷移不能 (例: `installing` 中の launch-token 要求)          |
| 410    | `installation-deleted`        | uninstall 済み id (30 日 retention 中の参照)                    |
| 422    | `manifest-compile-failed`     | takosumi-git の manifest compile エラー                         |
| 422    | `permission-preview-required` | upgrade で permission diff があるのに `confirm` 未指定          |
| 422    | `cost-cap-exceeded`           | preview の `maxMonthlyWithoutApproval` 超過 + ack 無し          |
| 429    | `rate-limit-exceeded`         | rate limit 超過 (`Retry-After` header 同梱)                     |
| 502    | `dependency-failure`          | takosumi-git / Stripe / DNS 等の依存失敗                        |

### 0.5 AppInstallation Status Enum {#status-enum}

`installation.status` は本 API および
[AppInstallation 台帳](/architecture/app-installation) を通して **canonical な
5 値**に正規化される。glossary
[AppInstallation](/reference/glossary#appinstallation) と整合する。

| status        | 意味                                                                  |
| ------------- | --------------------------------------------------------------------- |
| `installing`  | install pipeline 進行中 (= takosumi-git が manifest compile / kernel apply 中) |
| `ready`       | 利用可能 (`shared-cell` / `dedicated` どちらでも mode を問わず ready) |
| `failed`      | install / upgrade / materialize 失敗 (event log で原因を確認)         |
| `suspended`   | 一時停止 (billing 失敗 / abuse / operator 操作)                       |
| `exported`    | self-host export 完了。本 takosumi では retire され launch-token 発行不可 |

#### Transitional substate

実装は `ready` / `failed` 等への遷移途中で transitional substate を expose
することがある。これらは **canonical 5 値の transition phase** であり、
独立した安定 status ではない。長期保存・client-side state machine は
canonical 5 値で組み、transitional substate は in-flight phase hint として
読むこと。

| substate         | 親 status (遷移先候補)                              | 出現する operation                                |
| ---------------- | --------------------------------------------------- | ------------------------------------------------- |
| `materializing`  | `ready` (mode=dedicated) または `failed` rollback    | `POST /v1/installations/{id}/materialize`         |
| `uninstalling`   | `exported` / `failed` / 削除                         | `DELETE /v1/installations/{id}` (uninstall 経路)  |
| `exporting`      | `ready` (export 完了後) または `exported` (退出時)   | `POST /v1/installations/{id}/export`              |
| `upgrading`      | `ready` (新 manifest digest) または `failed`         | upgrade pipeline (Phase 1.5)                      |
| `rolling-back`   | `ready` (旧 manifest digest) または `failed`         | rollback pipeline (Phase 1.5)                     |
| `materialized`   | `ready` (mode=dedicated; deprecated alias)           | legacy event payload。`ready` + mode で表現する   |
| `migrating`      | `ready` (data migration 完了) または `failed`        | resource migration ledger ([Glossary](/reference/glossary#migrationledger)) |
| `pending`        | `installing` (queue 滞留)                            | rate-limit / queue backpressure                   |

`state-conflict` (§0.4) は **canonical 5 値および transitional substate
両方を含む** 現在 status と要求 operation の組合せ違反を返す。

## 1. `POST /v1/install/preview`

Install 操作の **副作用ゼロな preview** を返す。Source pin → app.yml parse →
Binding / Grant 解決 → cost estimate → publisher verify を行い、UI が
approve gate に出すデータを生成する。

### 1.1 Request

```http
POST /v1/install/preview HTTP/1.1
Host: api.takosumi.cloud
Authorization: Bearer <token>
Idempotency-Key: 6d2a... (optional)
Content-Type: application/json

{
  "source": {
    "type": "git",
    "url": "https://github.com/takos/takos",
    "ref": "v1.2.3"
  },
  "spaceId": "space_personal",
  "mode": "shared-cell",
  "params": {
    "domain": "auto"
  }
}
```

| field          | type                                          | required | 注                                              |
| -------------- | --------------------------------------------- | -------- | ----------------------------------------------- |
| `source.type`  | `"git"` \| `"export-bundle"`                  | yes      | `export-bundle` は self-host 経路               |
| `source.url`   | URL                                           | cond     | `type=git` のとき必須                           |
| `source.ref`   | string                                        | cond     | tag or commit SHA。mutable ref は 400           |
| `source.bundleRef` | URI                                       | cond     | `type=export-bundle` のとき必須                 |
| `spaceId`      | string                                        | yes      | actor が member 以上                            |
| `mode`         | `shared-cell` \| `dedicated` \| `self-hosted` | no       | default `shared-cell`                           |
| `params`       | object                                        | no       | `.takosumi/app.yml` の `entry.params` schema 準拠 |

### 1.2 Response (200)

```json
{
  "previewId": "prev_01J...",
  "expiresAt": "2026-05-07T09:00:00Z",
  "app": {
    "id": "takos.chat",
    "name": "Takos",
    "version": "1.2.3",
    "publisher": {
      "id": "pub_takos",
      "name": "takos",
      "verified": true,
      "verificationMethod": "dns+ed25519"
    }
  },
  "source": {
    "type": "git",
    "url": "https://github.com/takos/takos",
    "ref": "v1.2.3",
    "commit": "7f3c9f5b...",
    "appManifestDigest": "sha256:..."
  },
  "requestedBindings": [
    { "kind": "identity.oidc@v1", "providerHint": "managed" },
    { "kind": "database.postgres@v1", "plan": "small" },
    { "kind": "object-store.s3-compatible@v1", "plan": "standard" },
    { "kind": "deploy-intent.gitops@v1", "providerHint": "managed" }
  ],
  "requestedGrants": [
    "app.profile.write",
    "app.memory.write",
    "deploy.intent.write",
    "logs.read.own"
  ],
  "estimatedCost": {
    "currency": "JPY",
    "minMonthly": 0,
    "maxMonthlyWithoutApproval": 3000,
    "breakdown": [
      { "item": "shared-cell base", "monthly": 0 },
      { "item": "object-store standard (estimate)", "monthly": 1500 },
      { "item": "egress (estimate)", "monthly": 1500 }
    ]
  },
  "warnings": [],
  "permissionDigest": "sha256:..."
}
```

- `previewId` は `POST /v1/installations` の `confirm.previewId` に渡す
  (preview ↔ install の同一性 anchor)。
- `permissionDigest` = sorted `requestedGrants` ++ `requestedBindings.kind`
  の SHA-256。upgrade の permission diff approve に再利用される。

### 1.3 主なステータス

| code | 条件                                        |
| ---- | ------------------------------------------- |
| 200  | 成功                                        |
| 400  | `validation-failed` / `mutable-ref-rejected`|
| 401  | `unauthenticated`                           |
| 403  | `forbidden`                                 |
| 422  | `manifest-compile-failed`                   |
| 429  | `rate-limit-exceeded`                       |
| 502  | git fetch / DNS verify 失敗                 |

## 2. `POST /v1/installations`

新規 AppInstallation を作成し、takosumi-git に install pipeline を起動する。
**non-blocking**: response は `status=installing` で返り、進捗は
`GET /v1/installations/{id}/events` で stream する。

### 2.1 Request

```http
POST /v1/installations HTTP/1.1
Authorization: Bearer <token>
Idempotency-Key: <uuid>      # required
Content-Type: application/json

{
  "spec": {
    "source": {
      "type": "git",
      "url": "https://github.com/takos/takos",
      "ref": "v1.2.3"
    },
    "spaceId": "space_personal",
    "mode": "shared-cell",
    "params": { "domain": "auto" }
  },
  "confirm": {
    "previewId": "prev_01J...",
    "permissionDigest": "sha256:...",
    "costAck": false
  }
}
```

`confirm.previewId` は直前の preview を anchor する。10 分以上前の previewId
は `422`。`confirm.permissionDigest` が preview と一致しない場合は
`422 permission-preview-required`。

### 2.2 Response (202)

```json
{
  "installation": {
    "id": "inst_01J...",
    "accountId": "acct_123",
    "spaceId": "space_personal",
    "appId": "takos.chat",
    "source": {
      "type": "git",
      "url": "https://github.com/takos/takos",
      "ref": "v1.2.3",
      "commit": "7f3c9f5b..."
    },
    "appManifestDigest": "sha256:...",
    "compiledManifestDigest": null,
    "mode": "shared-cell",
    "runtimeBinding": null,
    "status": "installing",
    "createdBySubject": "user_abc",
    "createdAt": "2026-05-07T08:30:00Z",
    "updatedAt": "2026-05-07T08:30:00Z"
  },
  "tracking": {
    "eventsUrl": "/v1/installations/inst_01J.../events",
    "etaSeconds": 90
  }
}
```

response header に `Location: /v1/installations/inst_01J...` を付与。
`compiledManifestDigest` / `runtimeBinding` は `installation.deployed` event
後に埋まる。

### 2.3 主なステータス

| code | 条件                                                        |
| ---- | ----------------------------------------------------------- |
| 202  | 受理 (非同期で installer pipeline 起動)                     |
| 400  | `validation-failed`                                         |
| 401  | `unauthenticated`                                           |
| 403  | `forbidden` (要 admin role / `takosumi.install` scope)      |
| 409  | `idempotency-key-conflict` / `state-conflict`               |
| 422  | `permission-preview-required` / `cost-cap-exceeded` / `manifest-compile-failed` |
| 429  | `rate-limit-exceeded`                                       |

### 2.4 self-host install

`mode=self-hosted` は **takosumi-cloud では作成しない**。代わりに
`409 state-conflict` を返し、Problem の `detail` に
`Use takosumi install <bundle> --to <self-hosted endpoint>` を案内する
([Upgrade / Export](/platform/upgrade-export#self-host-import) 参照)。

## 3. `POST /v1/installations/{id}/launch-token` {#launch-token}

[launch token JWS](/apps/launch-token) を 1 つ発行する。install 直後の
1-shot 自動 sign-in、または re-launch 用。

> JWS の payload / claim / 検証手順は [Launch Token](/apps/launch-token)
> ページが正本。本 endpoint はその発行 API。両ページを併せて読むこと。

### 3.1 Request

```http
POST /v1/installations/inst_01J.../launch-token HTTP/1.1
Authorization: Bearer <token>
Idempotency-Key: <uuid>      # optional

{
  "purpose": "install-bootstrap",
  "ttlSeconds": 120,
  "redirectUri": "https://takos-acct123.takosumi.app/_takosumi/launch"
}
```

| field          | type                                  | 注                                                          |
| -------------- | ------------------------------------- | ----------------------------------------------------------- |
| `purpose`      | `install-bootstrap` \| `re-launch`    | install 直後 / 後の re-launch を区別                        |
| `ttlSeconds`   | int (10..300, default 120)            | 5 分上限                                                    |
| `redirectUri`  | URI                                   | OidcClientBinding の `redirectUris` か `/_takosumi/launch` のいずれかと完全一致必須 |

### 3.2 Response (200)

```json
{
  "url": "https://takos-acct123.takosumi.app/_takosumi/launch?token=eyJhbGciOi...",
  "token": "eyJhbGciOi...",
  "expiresAt": "2026-05-07T08:35:00Z",
  "jti": "01J...",
  "audience": "takos.chat"
}
```

token は `typ: takosumi-install-launch+jwt`。one-time (server 側で `jti`
消費)。詳細は [Launch Token](/apps/launch-token) を参照。

### 3.3 主なステータス

| code | 条件                                                                   |
| ---- | ---------------------------------------------------------------------- |
| 200  | 成功                                                                   |
| 400  | `validation-failed` / `redirectUri` 不一致                             |
| 401 / 403 / 404 | 既出                                                        |
| 409  | `state-conflict` (canonical status が `installing` / `failed` / `suspended` / `exported` のとき、または transitional substate (例: `uninstalling`) のとき発行不可。launch-token は status=`ready` 専用) |

## 4. `POST /v1/installations/{id}/materialize`

`shared-cell → dedicated` 昇格。同一 source commit / app manifest digest /
data namespace / OIDC binding / domain を引き継ぐ。

### 4.1 Request

```http
POST /v1/installations/inst_01J.../materialize HTTP/1.1
Authorization: Bearer <token>
Idempotency-Key: <uuid>      # required

{
  "mode": "dedicated",
  "region": "tokyo",
  "plan": {
    "compute": "small",
    "database": "small",
    "objectStore": "standard"
  },
  "cutover": {
    "strategy": "blue-green",
    "drainSeconds": 30
  },
  "confirm": {
    "costAck": true,
    "permissionDigest": "sha256:..."
  }
}
```

| field                  | 注                                                                    |
| ---------------------- | --------------------------------------------------------------------- |
| `mode`                 | `dedicated` 固定 (`self-hosted` 化は `POST /export` 経由)             |
| `region`               | 利用可能 region (例: `tokyo`, `osaka`)                                |
| `plan.*`               | dedicated 用 plan                                                     |
| `cutover.strategy`     | `blue-green` (default) / `cutover-now`                                |
| `cutover.drainSeconds` | int (0..600). shared-cell 側 drain 秒数                               |

### 4.2 Response (202)

```json
{
  "operationId": "op_01J...",
  "installationId": "inst_01J...",
  "fromMode": "shared-cell",
  "toMode": "dedicated",
  "etaSeconds": 600,
  "trackingUrl": "/v1/installations/inst_01J.../events?types=installation.materialize-requested,installation.materialize-succeeded"
}
```

state は canonical `ready` → transitional `materializing` → canonical
`ready` (mode=dedicated) の遷移を辿る ([§0.5](#status-enum))。失敗時は
`installation.materialize-failed` event を発火し、canonical status は
`ready` (mode 維持) に rollback (重大失敗時は `failed`)。

### 4.3 主なステータス

| code | 条件                                                                           |
| ---- | ------------------------------------------------------------------------------ |
| 202  | 受理                                                                           |
| 400 / 422 | `validation-failed` / `cost-cap-exceeded`                                 |
| 403  | `forbidden` (要 `owner` role)                                                  |
| 404 / 410 | 既出                                                                       |
| 409  | `state-conflict` (mode が既に dedicated / canonical status が `ready` 以外、または transitional substate (`materializing` / `upgrading` / `rolling-back` / `uninstalling`) のとき) / `installation-locked` |
| 502  | `dependency-failure` (kernel deploy 経路失敗)                                  |

## 5. `POST /v1/installations/{id}/export`

[Export bundle](/platform/upgrade-export#export-bundle) を非同期に生成する。
生成完了後、署名付き short-lived URL を返す (download は別 endpoint
`GET /v1/installations/{id}/exports/{opId}` で 24h 有効)。

### 5.1 Request

```http
POST /v1/installations/inst_01J.../export HTTP/1.1
Authorization: Bearer <token>
Idempotency-Key: <uuid>      # required

{
  "includeData": true,
  "format": "bundle",
  "encryption": {
    "method": "age",
    "recipients": ["age1..."]
  },
  "scope": {
    "data": ["postgres", "blobs", "memory", "profiles"],
    "secrets": "templates-only"
  }
}
```

| field                       | 注                                                              |
| --------------------------- | --------------------------------------------------------------- |
| `includeData`               | `false` → metadata のみ                                         |
| `format`                    | `bundle` (tar.zst)                                              |
| `encryption.method`         | `none` / `age` (default 推奨)                                   |
| `encryption.recipients`     | `age` の場合必須                                                |
| `scope.data`                | 取得する data partition                                         |
| `scope.secrets`             | `templates-only` / `with-references` (secret 実値は出さない)    |

### 5.2 Response (202)

```json
{
  "operationId": "op_01J...",
  "status": "preparing",
  "trackingUrl": "/v1/installations/inst_01J.../events?types=installation.exported",
  "downloadUrl": null,
  "downloadExpiresAt": null
}
```

完了通知は SSE / poll で `installation.exported` event を受け取り、
`GET /v1/installations/{id}/exports/{opId}` から signed download URL を取得する。

### 5.3 主なステータス

| code | 条件                                                                        |
| ---- | --------------------------------------------------------------------------- |
| 202  | 受理                                                                        |
| 400 / 422 | `validation-failed` / scope 不正                                       |
| 403  | role / grant                                                                |
| 404 / 410 | 既出                                                                    |
| 409  | `state-conflict` (canonical status が `installing` のとき、または transitional substate (`materializing` / `uninstalling` / `exporting`) のとき。詳細は [§0.5](#status-enum)) |

## 5.4 Cross-instance import flow

> **Implementation status**: `.takosumi/app.yml` の `service.import@v1`
> validation、AppInstallation ledger kind、kernel manifest import resolution は
> 実装済みです。本節の `requestedImports[]` を含む preview / install API の
> full materialization flow は継続 work です。設計の正本は
> [architecture/cross-instance-service-binding](/architecture/cross-instance-service-binding)、
> manifest schema は
> [reference/manifest-spec § 14](/reference/manifest-spec#cross-instance-imports)
> を参照。

`POST /v1/install/preview` および `POST /v1/installations` の request body
に **`requestedImports[]`** field が追加されます。 forward 3-level dotted
service identifier で外部 service への接続を declare します。

### Request body 拡張 (preview / install 共通)

```json
{
  "git": "https://github.com/example/my-app",
  "ref": "v1.0.0",
  "requestedBindings": [],
  "requestedImports": [
    {
      "alias": "account-auth",
      "service": "takosumi.account.auth@v1",
      "refreshPolicy": { "kind": "ttl", "ttl": "300s" }
    }
  ],
  "serviceResolvers": [
    {
      "kind": "anchor",
      "url": "https://my-anchor.example.com/v1/services/",
      "publicKeyRef": "vault://anchor-pubkey"
    }
  ]
}
```

| field              | required | type   | 説明                                                                  |
| ------------------ | -------- | ------ | --------------------------------------------------------------------- |
| `requestedImports` | no       | array  | service identifier import declaration (manifest `imports[]` と同 schema) |
| `serviceResolvers` | cond     | array  | anchor pin (`requestedImports[]` を持つ install request では必須)     |

### Preview behavior

`POST /v1/install/preview` は `requestedImports[]` を受け取ると:

1. `serviceResolvers[].url` (anchor) に対して各 service identifier の resolve
   を試行
2. 取得した `ServiceDescriptor` を preview response の `resolvedImports[]` に
   含めて返す
3. signature verify / contract version match を pre-check
4. failure (anchor unreachable / signature mismatch / version skew) は
   `422 cross-instance-import-resolution-failed` を返す

### Install behavior

`POST /v1/installations` 受理後、 takosumi-git installer pipeline が:

1. anchor から `ServiceDescriptor` を fetch
2. signature verify (invariant 16)
3. contract version pin
4. `Deployment.resolution.descriptor_closure` に descriptor を pin
   (invariant 17)
5. `CrossInstanceShare` audit record を append
6. compiled manifest の `${imports.<alias>.endpoints.<role>.url}` placeholder
   を解決して env / config に inject

failure modes は `409 state-conflict` または `422 ...-resolution-failed` で
返される。

### Refresh / Revoke

- Refresh: anchor 経由で再 fetch、 `refreshPolicy.ttl` 内なら cached descriptor
  継続、 期限切れは新 Deployment が必要 (descriptor immutability)
- Revoke: AppGrant revoke 経路と統合 (詳細は [Layer A export](/platform/upgrade-export))

## 6. Cross-link

- [Install paths](/apps/install-paths) — Use Takos / Install from Git /
  Self-host の 3 path から本 API がどう呼ばれるか
- [Installer Pipeline](/architecture/installer-pipeline) — `POST /v1/installations`
  受理後に takosumi-git が走らせる 13 step の詳細
- [Binding Catalog](/reference/binding-catalog) — `requestedBindings[].kind`
  に登場する 7 種の binding 型 (`service.import@v1` を含む)
- [`.takosumi/app.yml` Spec](/reference/app-yml-spec) — preview / install が
  parse する manifest 仕様
- [Launch Token](/apps/launch-token) — §3 で発行される JWS の format / 検証
- [Upgrade / Export](/platform/upgrade-export) — §5 export bundle の構造と
  self-host import 手順
- [Takosumi Accounts](/architecture/takosumi-accounts) — 認証 token の発行元

## 次に読むページ

- 開発者として API を叩くなら → [Install paths](/apps/install-paths)
- binding を追加 / 変更したいなら → [Binding Catalog](/reference/binding-catalog)
- export して self-host に移したいなら → [Upgrade / Export](/platform/upgrade-export)
- 用語の正本 → [Glossary](/reference/glossary)
