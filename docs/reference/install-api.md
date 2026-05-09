# Install API

Installable App Model の installation lifecycle を駆動する **Takosumi Accounts
(= takosumi-cloud account plane) が公開する REST API** の仕様です。

このページで依存してよい範囲:

- Takosumi Accounts service が実装済みの install preview / AppInstallation /
  launch-token endpoint の HTTP method / path / request body / response shape
- Phase 1.6 design と明記された materialize / export endpoint の予定 wire shape
- 認証 (Takosumi Accounts session = OIDC bearer / PAT)
- error response の HTTP status と code 形式
- API path prefix: `/v1`。managed default の base URL は例であり、operator
  は任意の hostname で Takosumi Accounts API を expose できる

このページで依存してはいけない範囲:

- takosumi-cloud 内部の persistence model: AppInstallation table の column 名や
  index は変わりうる。**API の wire shape のみが contract**。
- takosumi kernel API: 本 API は **takosumi kernel を 1 行も触らない**。kernel
  への伝播は takosumi-git が compiled manifest 経由で行う。
- Takosumi Accounts の OIDC issuer 内部実装: token format などは
  [Takosumi Accounts](/architecture/takosumi-accounts) を参照。

## 0. 共通事項

### 0.1 Base URL と version

| 項目                       | 値                                                                   |
| -------------------------- | -------------------------------------------------------------------- |
| managed default base URL   | `https://api.takosumi.cloud` (example)                               |
| optional same-origin alias | `https://accounts.example.com/api` 等、operator が expose する alias |
| API version prefix         | `/v1`                                                                |
| Content-Type               | `application/json; charset=utf-8`                                    |
| Date format                | RFC 3339 (`2026-05-07T08:30:00Z`)                                    |

client は operator / install context から渡された Accounts API base URL を使う。
OIDC issuer 自体も service identifier `takosumi.account.auth@v1` と anchor
resolver から解決されるため、特定 hostname を contract にしない。

### 0.2 認証

caller は **Takosumi Accounts session** を保持している必要がある。

| 方式                    | header                                        | 用途                                                                                                                                      |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| OIDC bearer             | `Authorization: Bearer <jwt>`                 | 通常の human / app 操作。issuer は service identifier `takosumi.account.auth@v1` から anchor 経由で resolved された operator-injected URL |
| Personal Access Token   | `Authorization: Bearer takpat_<base32>`       | takos-cli / 自動化。Takosumi Accounts の PAT                                                                                              |
| Service-to-service HMAC | `Authorization: TakosumiHmac key=...,sig=...` | takosumi-git → takosumi-cloud の internal call (event 投函等)                                                                             |

token 検証:

- `iss` = service identifier `takosumi.account.auth@v1` から resolved された
  OIDC issuer URL (managed default hostname は example)
- `aud` ⊇ `takosumi-cloud-api`
- `exp` 未過、`nbf` 過、`iat` skew ≤ 60s
- `takosumi.account_id` claim を request の **actor account** とする
- `takosumi.role` (`owner` / `admin` / `member` / `viewer`) で権限判定

### 0.3 Idempotency-Key

Phase 1.6 design endpoint では `Idempotency-Key` header を使い、24 時間内に 同
key + 同 body で再送した場合は同じ response を返す想定です。現行の
contract-backed AppInstallation endpoint は idempotency ledger をまだ公開して
いないため、重複作成は `installation_already_exists` で扱います。 `materialize`
/ `export` request endpoint は requested event に request digest を保存し、同じ
key で別 body が来た場合は `409 idempotency_key_conflict` を 返します。

| endpoint                                   | Idempotency-Key                 |
| ------------------------------------------ | ------------------------------- |
| `POST /v1/install/preview`                 | optional                        |
| `POST /v1/installations`                   | not enforced                    |
| `POST /v1/installations/{id}/launch-token` | optional                        |
| `POST /v1/installations/{id}/upgrade`      | not enforced                    |
| `POST /v1/installations/{id}/rollback`     | not enforced                    |
| `POST /v1/installations/{id}/materialize`  | **required** (Phase 1.6 design) |
| `POST /v1/installations/{id}/export`       | **required** (Phase 1.6 design) |

### 0.4 Error response

現行 Takosumi Accounts service は JSON error object を返します。

```json
{
  "error": "invalid_request",
  "error_description": "Optional concrete description"
}
```

`error` は snake_case の machine code、`error_description` は optional です。
Phase 1.6 design endpoint の長時間 operation では追加 metadata を返す可能性が
ありますが、現行 contract-backed endpoint はこの shape に揃えます。

主要 error:

| status | error                            | 用途                                                   |
| ------ | -------------------------------- | ------------------------------------------------------ |
| 400    | `invalid_request`                | request body / query が schema に合わない              |
| 400    | `invalid_bindings`               | requested AppBinding declaration が catalog に合わない |
| 400    | `invalid_grants`                 | requested AppGrant 配列が object/array shape 不正      |
| 404    | `installation_not_found`         | id 不在                                                |
| 404    | `grant_not_found`                | grant id 不在                                          |
| 404    | `oidc_client_not_found`          | per-installation OIDC client 不在                      |
| 409    | `installation_already_exists`    | 同じ installation id が既に存在                        |
| 409    | `space_account_mismatch`         | account と space の対応が不正                          |
| 409    | `state_conflict`                 | 状態遷移不能 (例: `installing` 中の launch-token 要求) |
| 409    | `launch_token_replayed`          | launch token jti が既に消費済み                        |
| 422    | `invalid_grant_capability`       | grant capability が v1 catalog 外                      |
| 503    | `install_preview_not_configured` | install preview proxy 未設定                           |
| 503    | `launch_tokens_not_configured`   | launch token issuer 未設定                             |

### 0.5 AppInstallation Status Enum {#status-enum}

`installation.status` は本 API および
[AppInstallation 台帳](/architecture/app-installation) を通して **canonical な 5
値**に正規化される。glossary
[AppInstallation](/reference/glossary#appinstallation) と整合する。

| status       | 意味                                                                           |
| ------------ | ------------------------------------------------------------------------------ |
| `installing` | install pipeline 進行中 (= takosumi-git が manifest compile / kernel apply 中) |
| `ready`      | 利用可能 (`shared-cell` / `dedicated` どちらでも mode を問わず ready)          |
| `failed`     | install / upgrade / materialize 失敗 (event log で原因を確認)                  |
| `suspended`  | 一時停止 (billing 失敗 / abuse / operator 操作)                                |
| `exported`   | self-host export 完了。本 takosumi では retire され launch-token 発行不可      |

#### Transitional substate

実装済みの ledger record は `substate` field を持たず、外部公開 status は
canonical 5 値のみです。transitional substate は **operation metadata /
InstallationEvent payload の phase hint** であり、独立した安定 status では
ありません。長期保存・client-side state machine は canonical 5 値で組むこと。

| substate        | 親 status (遷移先候補)                             | 出現する operation                                                          |
| --------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `materializing` | `ready` (mode=dedicated) または `failed` rollback  | `POST /v1/installations/{id}/materialize`                                   |
| `uninstalling`  | `exported` / `failed` / 削除                       | `DELETE /v1/installations/{id}` (uninstall 経路)                            |
| `exporting`     | `ready` (export 完了後) または `exported` (退出時) | `POST /v1/installations/{id}/export`                                        |
| `upgrading`     | `ready` (新 manifest digest) または `failed`       | `POST /v1/installations/{id}/upgrade`                                       |
| `rolling-back`  | `ready` (旧 manifest digest) または `failed`       | `POST /v1/installations/{id}/rollback`                                      |
| `materialized`  | `ready` (mode=dedicated; deprecated alias)         | legacy event payload。`ready` + mode で表現する                             |
| `migrating`     | `ready` (data migration 完了) または `failed`      | resource migration ledger ([Glossary](/reference/glossary#migrationledger)) |
| `pending`       | `installing` (queue 滞留)                          | rate-limit / queue backpressure                                             |

`state_conflict` (§0.4) は canonical 5 値と、operation metadata に残る in-flight
phase を合わせて要求 operation の組合せ違反を返す。

## 1. `POST /v1/install/preview`

Install 操作の **副作用ゼロな preview** を返す。Source pin → app.yml parse →
Binding / Grant 解決 → cost estimate → publisher verify を行い、UI が approve
gate に出すデータを生成する。

### 1.1 Request

```http
POST /v1/install/preview HTTP/1.1
Host: <ACCOUNTS_API_HOST>
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

| field              | type                                          | required | 注                                                |
| ------------------ | --------------------------------------------- | -------- | ------------------------------------------------- |
| `source.type`      | `"git"` \| `"export-bundle"`                  | yes      | `export-bundle` は self-host 経路                 |
| `source.url`       | URL                                           | cond     | `type=git` のとき必須                             |
| `source.ref`       | string                                        | cond     | tag or commit SHA。mutable ref は 400             |
| `source.bundleRef` | URI                                           | cond     | `type=export-bundle` のとき必須                   |
| `spaceId`          | string                                        | yes      | actor が member 以上                              |
| `mode`             | `shared-cell` \| `dedicated` \| `self-hosted` | no       | default `shared-cell`                             |
| `params`           | object                                        | no       | `.takosumi/app.yml` の `entry.params` schema 準拠 |

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

- `previewId` は `POST /v1/installations` の `confirm.previewId` に渡す (preview
  ↔ install の同一性 anchor)。
- `permissionDigest` = sorted `requestedGrants` ++ `requestedBindings.kind` の
  SHA-256。upgrade の permission diff approve に再利用される。

### 1.3 主なステータス

| code | 条件                                               |
| ---- | -------------------------------------------------- |
| 200  | 成功                                               |
| 400  | `invalid_json` / `invalid_install_preview_request` |
| 401  | `invalid_signature`                                |
| 422  | `invalid_installable_app`                          |
| 429  | `rate_limited`                                     |
| 502  | git fetch / DNS verify 失敗                        |

## 2. `POST /v1/installations`

新規 AppInstallation ledger record を作成する。現行 Takosumi Accounts service
では、Git fetch / manifest compile / kernel apply はこの endpoint 内では行わず、
takosumi-git install pipeline または install preview proxy が解決済み source
metadata を渡す。response は `status=installing` で返り、進捗は
`GET /v1/installations/{id}/events` の event list で確認する。

### 2.1 Request

```http
POST /v1/installations HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{
  "installationId": "inst_01J...",
  "accountId": "acct_123",
  "spaceId": "space_personal",
  "spaceKind": "personal",
  "appId": "takos.chat",
  "source": {
    "gitUrl": "https://github.com/takos/takos",
    "ref": "v1.2.3",
    "commit": "7f3c9f5b...",
    "appManifestDigest": "sha256:app",
    "compiledManifestDigest": "sha256:compiled"
  },
  "mode": "shared-cell",
  "createdBySubject": "tsub_owner",
  "runtimeBinding": {
    "runtimeBindingId": "rtb_01J...",
    "targetType": "shared-cell",
    "targetId": "shared-cell://tokyo-cell-01/namespaces/inst_01J..."
  },
  "bindings": [{
    "bindingId": "bind_auth",
    "name": "auth",
    "kind": "identity.oidc@v1",
    "configRef": "config://inst_01J/auth",
    "declaration": {
      "type": "identity.oidc@v1",
      "required": true,
      "redirectPaths": ["/auth/oidc/callback"]
    },
    "secretRefs": ["secret://inst_01J/auth/client-secret"]
  }],
  "grants": [{
    "grantId": "grant_logs",
    "capability": "logs.read.own",
    "scope": {}
  }],
  "serviceImports": [{
    "binding": "account-auth",
    "alias": "account-auth",
    "service": "takosumi.account.auth@v1",
    "endpointRoles": ["oidc-issuer", "install-launch"]
  }]
}
```

必須 field は `accountId` / `spaceId` / `appId` / `source.gitUrl` (または
`source.url`) / `source.ref` / `source.commit` / `source.appManifestDigest` /
`mode` / `createdBySubject`。`installationId` は 省略時に `inst_<uuid>`
が採番される。`source.compiledManifestDigest` / `runtimeBinding` / `bindings` /
`grants` / `serviceImports` / `oidcClients` は
optional。`bindings[].declaration` は takosumi-git が `.takosumi/app.yml`
の承認済み binding declaration を添付する field で、Accounts provider
materializer はこの値を使って provider-owned `configRef` / `secretRefs` と
one-shot `binding_env` を返す。

`confirm.previewId` / `permissionDigest` gate は current service では未実装で、
Phase 1.6 design の permission diff gate で扱う。

### 2.2 Response (202)

```json
{
  "installation": {
    "id": "inst_01J...",
    "account_id": "acct_123",
    "space_id": "space_personal",
    "app_id": "takos.chat",
    "source": {
      "type": "git",
      "url": "https://github.com/takos/takos",
      "ref": "v1.2.3",
      "commit": "7f3c9f5b..."
    },
    "app_manifest_digest": "sha256:app",
    "compiled_manifest_digest": "sha256:compiled",
    "service_imports": [{
      "binding": "account-auth",
      "alias": "account-auth",
      "service": "takosumi.account.auth@v1",
      "endpointRoles": ["oidc-issuer", "install-launch"]
    }],
    "mode": "shared-cell",
    "runtime_binding_id": "rtb_01J...",
    "status": "installing",
    "created_by_subject": "tsub_owner",
    "created_at": "2026-05-07T08:30:00.000Z",
    "updated_at": "2026-05-07T08:30:00.000Z"
  },
  "bindings": [{
    "id": "bind_auth",
    "installation_id": "inst_01J...",
    "name": "auth",
    "kind": "identity.oidc@v1",
    "config_ref": "config://inst_01J/auth",
    "secret_refs": ["secret://inst_01J/auth/client-secret"],
    "created_at": "2026-05-07T08:30:00.000Z",
    "updated_at": "2026-05-07T08:30:00.000Z"
  }],
  "grants": [{
    "id": "grant_logs",
    "installation_id": "inst_01J...",
    "capability": "logs.read.own",
    "scope": {},
    "granted_at": "2026-05-07T08:30:00.000Z",
    "revoked_at": null
  }],
  "runtime_binding": {
    "id": "rtb_01J...",
    "installation_id": "inst_01J...",
    "mode": "shared-cell",
    "target_type": "shared-cell",
    "target_id": "shared-cell://tokyo-cell-01/namespaces/inst_01J...",
    "created_at": "2026-05-07T08:30:00.000Z",
    "updated_at": "2026-05-07T08:30:00.000Z"
  },
  "oidc_client": null,
  "binding_env": {
    "DATABASE_URL": "postgres://...",
    "BLOB_ENDPOINT": "https://objects.example.test",
    "BLOB_BUCKET": "inst-01j",
    "BLOB_ACCESS_KEY": "access-key",
    "BLOB_SECRET_KEY": "secret-key"
  },
  "tracking": {
    "events_url": "/v1/installations/inst_01J.../events"
  }
}
```

response header に `Location: /v1/installations/inst_01J...` を付与。
`oidcClients` request を含む場合は `oidc_client` と `oidc_client_secret` が
追加される。provider-backed AppBinding が materialize された場合は `binding_env`
が追加され、takosumi-git が kernel deploy request の runtime env に
注入する。`binding_env` は create response の one-shot material であり、
`GET /v1/installations/{id}` などの inspect response には raw secret value を
含めない。

### 2.3 主なステータス

| code | 条件                                                                                                           |
| ---- | -------------------------------------------------------------------------------------------------------------- |
| 202  | 受理 (非同期で installer pipeline 起動)                                                                        |
| 400  | `invalid_request` / `invalid_bindings` / `invalid_service_imports` / `invalid_grants` / `invalid_oidc_clients` |
| 409  | `installation_already_exists` / `space_account_mismatch`                                                       |
| 422  | `invalid_grant_capability`                                                                                     |

### 2.4 self-host install

`mode=self-hosted` は **takosumi-cloud では作成しない**。代わりに
`409 state_conflict` を返し、`error_description` に
`Use takosumi-git install <bundle> --to <self-hosted endpoint>` を案内する
([Upgrade / Export](/platform/upgrade-export#self-host-import) 参照)。

## 3. `GET/POST /v1/installations/{id}/launch-token` {#launch-token}

`GET` は [launch token JWS](/apps/launch-token) を検証するための public config
を返す。`POST` は launch token JWS を 1 つ発行する。install 直後の 1-shot 自動
sign-in、または re-launch 用。

> JWS の payload / claim / 検証手順は [Launch Token](/apps/launch-token)
> ページが正本。本 endpoint はその発行 API。両ページを併せて読むこと。

### 3.1 Verification config (GET)

```http
GET /v1/installations/inst_01J.../launch-token HTTP/1.1
Authorization: Bearer <token>
```

```json
{
  "issuer": "https://accounts.example.test",
  "audience": "takos.chat",
  "algorithm": "RS256",
  "kid": "launch-key-2026-05",
  "jwks": { "keys": [{ "kty": "RSA", "kid": "launch-key-2026-05" }] },
  "public_key": "{\"keys\":[...]}",
  "env": {
    "INSTALL_LAUNCH_PUBLIC_KEY": "{\"keys\":[...]}",
    "INSTALL_LAUNCH_AUDIENCE": "takos.chat",
    "INSTALL_LAUNCH_ISSUER": "https://accounts.example.test"
  }
}
```

`public_key` / `env.INSTALL_LAUNCH_PUBLIC_KEY` は launch-token 専用 JWKS JSON。
OIDC `/oauth/jwks` とは別 key channel です。private signing key は Accounts
外へ出ません。

### 3.2 Issue request (POST)

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

| field         | type                               | 注                                                                                  |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------- |
| `purpose`     | `install-bootstrap` \| `re-launch` | install 直後 / 後の re-launch を区別                                                |
| `ttlSeconds`  | int (10..300, default 120)         | 5 分上限                                                                            |
| `redirectUri` | URI                                | OidcClientBinding の `redirectUris` か `/_takosumi/launch` のいずれかと完全一致必須 |

### 3.3 Issue response (200)

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

### 3.4 主なステータス

| code | 条件                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 200  | 成功                                                                                                                                                                                                   |
| 400  | `invalid_request` / redirect URI 不一致                                                                                                                                                                |
| 404  | `installation_not_found`                                                                                                                                                                               |
| 409  | `state_conflict` (canonical status が `installing` / `failed` / `suspended` / `exported` のとき、または operation metadata が in-flight phase を示すとき発行不可。launch-token は status=`ready` 専用) |
| 503  | `launch_tokens_not_configured`                                                                                                                                                                         |

## 3.5 `POST /v1/installations/{id}/upgrade` / `rollback` {#revision}

ready な AppInstallation の source pin と manifest digest を更新する。
takosumi-git CLI は `upgrade <id> --ref <ref>` / `rollback <id> --to <ref>` で
次 revision を preview し、`--apply` 時にこの endpoint を呼ぶ。

現行 endpoint は canonical status enum を増やさず、`ready` のまま
`installation.upgraded` / `installation.rolled_back` event を append する。
transitional `upgrading` / `rolling-back` は event payload 上の operation
metadata として扱い、安定 status にはしない。

### 3.5.1 Request

```http
POST /v1/installations/inst_01J.../upgrade HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json

{
  "appId": "takos.chat",
  "source": {
    "gitUrl": "https://github.com/takos/takos",
    "ref": "v1.2.4",
    "commit": "9d8e2...",
    "appManifestDigest": "sha256:app",
    "compiledManifestDigest": "sha256:compiled"
  },
  "serviceImports": [],
  "bindings": [],
  "grants": [],
  "reason": "release v1.2.4"
}
```

`rollback` は同じ body shape を使い、`source.ref` の代わりに top-level `to`
も受け付ける。`source.gitUrl` は既存 AppInstallation の source URL と一致する
必要がある。`source.ref` / `source.commit` / `source.appManifestDigest` は必須。

### 3.5.2 Response (200)

`POST /v1/installations` と同じ AppInstallation envelope に、`operation` と
append された `event` を加えて返す。

```json
{
  "operation": "upgrade",
  "installation": {
    "id": "inst_01J...",
    "source": {
      "url": "https://github.com/takos/takos",
      "ref": "v1.2.4",
      "commit": "9d8e2..."
    },
    "status": "ready"
  },
  "event": {
    "type": "installation.upgraded",
    "payload": {
      "previous": { "source": { "ref": "v1.2.3" } },
      "next": { "source": { "ref": "v1.2.4" } }
    }
  }
}
```

### 3.5.3 主なステータス

| code | 条件                                                                               |
| ---- | ---------------------------------------------------------------------------------- |
| 200  | revision 記録成功                                                                  |
| 400  | `invalid_request` / `invalid_bindings` / `invalid_grants`                          |
| 404  | `installation_not_found`                                                           |
| 409  | `state_conflict` (status が `ready` ではない) / `source_mismatch` / `app_mismatch` |
| 422  | binding / grant / service import catalog validation error                          |

## 4. `POST /v1/installations/{id}/materialize` (Phase 1.6 design)

`shared-cell → dedicated` 昇格。同一 source commit / app manifest digest / data
namespace / OIDC binding / domain を引き継ぐ。

> Current implementation: Accounts は request を受理し、
> `installation.materialize-requested` event を ledger に記録して 202 を返す。
> dedicated runtime 作成 / cutover は後続 worker 実装で行う。worker は完了時に
> `PATCH /v1/installations/{id}/status` へ `status=ready`、
> `mode=dedicated`、`operationId`、`runtimeBinding` を渡し、
> `installation.materialize-succeeded` event を append する。

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

| field                  | 注                                                        |
| ---------------------- | --------------------------------------------------------- |
| `mode`                 | `dedicated` 固定 (`self-hosted` 化は `POST /export` 経由) |
| `region`               | 利用可能 region (例: `tokyo`, `osaka`)                    |
| `plan.*`               | dedicated 用 plan                                         |
| `cutover.strategy`     | `blue-green` (default) / `cutover-now`                    |
| `cutover.drainSeconds` | int (0..600). shared-cell 側 drain 秒数                   |

### 4.2 Response (202)

```json
{
  "operationId": "op_01J...",
  "installationId": "inst_01J...",
  "fromMode": "shared-cell",
  "toMode": "dedicated",
  "preserveDigest": "sha256:...",
  "preserve": {
    "source": {
      "gitUrl": "https://github.com/example/app",
      "ref": "v1.2.3",
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "appManifestDigest": "sha256:...",
      "compiledManifestDigest": "sha256:..."
    },
    "dataNamespace": "shared-cell://tokyo-cell-01/namespaces/inst_01J...",
    "runtimeBinding": {
      "id": "rtb_01J...",
      "mode": "shared-cell",
      "targetType": "shared-cell",
      "targetId": "shared-cell://tokyo-cell-01/namespaces/inst_01J..."
    },
    "oidcClient": {
      "clientId": "toc_01J...",
      "serviceId": "takosumi.account.auth@v1",
      "issuerUrl": "https://accounts.example.test",
      "redirectUris": ["https://app.example.test/auth/oidc/callback"],
      "allowedScopes": ["openid", "profile"],
      "subjectMode": "pairwise",
      "tokenEndpointAuthMethod": "client_secret_post"
    },
    "bindings": [{
      "name": "auth",
      "kind": "identity.oidc@v1",
      "configRef": "takosumi-accounts://installations/inst_01J.../bindings/auth/oidc-client/toc_01J...",
      "secretRefs": [
        "takosumi-accounts://installations/inst_01J.../bindings/auth/secrets/client-secret"
      ]
    }, {
      "name": "domain",
      "kind": "domain.http@v1",
      "configRef": "takosumi-git://installable-app/example/bindings/domain",
      "secretRefs": []
    }]
  },
  "etaSeconds": 600,
  "trackingUrl": "/v1/installations/inst_01J.../events?types=installation.materialize-requested,installation.materialize-succeeded,installation.materialize-failed"
}
```

public status は canonical `ready` のまま維持し、materialize の進行は
transitional `materializing` phase hint と InstallationEvent で追跡する
([§0.5](#status-enum))。成功時は canonical `ready` + `mode=dedicated` に
なり、失敗時は `installation.materialize-failed` event を発火して canonical
status は `ready` (mode 維持) に rollback する。重大失敗時のみ `failed`
に落ちる。

Current Accounts service では materialize worker / operator が完了時に
`PATCH /v1/installations/{id}/status` へ以下を渡す:

```json
{
  "status": "ready",
  "mode": "dedicated",
  "operationId": "op_01J...",
  "preserveDigest": "sha256:...",
  "reason": "dedicated runtime ready",
  "runtimeBinding": {
    "runtimeBindingId": "rtb_01J...",
    "targetType": "dedicated",
    "targetId": "tokyo-dedicated-01"
  }
}
```

`preserve` は materialize request 時点の source commit / manifest digest /
shared data namespace / OIDC client / preserved AppBinding refs
(`identity.oidc@v1`, `database.postgres@v1`, `object-store.s3-compatible@v1`,
`domain.http@v1`) の snapshot です。 Accounts は snapshot digest を
`installation.materialize-requested` event に保存 し、completion patch には同じ
`preserveDigest` を要求する。これにより dedicated worker は materialize 対象の
namespace / OIDC / domain refs を取り違えたまま 完了できない。

同 patch は AppInstallation の `mode` / `runtimeBindingId` を更新し、
`installation.materialize-succeeded` event を append する。`operationId` 付き
completion / failure patch は必ず matching `installation.materialize-requested`
event を要求し、matching request がない場合、`preserveDigest` が一致しない
場合、または同 operation が既に closed の場合は `409` を返す。

失敗時は `PATCH /status` に `status=failed`、`operation=materialize`、
`operationId`、`reason` を渡すと `installation.materialize-failed` event を
append し、同 operation の in-flight lock を閉じる。

### 4.3 主なステータス

| code      | 条件                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 202       | 受理                                                                                                                                                         |
| 400 / 422 | `invalid_request` / `cost_cap_exceeded`                                                                                                                      |
| 403       | `forbidden` (要 `owner` role)                                                                                                                                |
| 404 / 410 | 既出                                                                                                                                                         |
| 409       | `state_conflict` (mode が既に dedicated / canonical status が `ready` 以外、または operation metadata が in-flight phase を示すとき) / `installation_locked` |
| 502       | `dependency_failure` (kernel deploy 経路失敗)                                                                                                                |

## 5. `POST /v1/installations/{id}/export` (Phase 1.6 design)

[Export bundle](/platform/upgrade-export#export-bundle) を非同期に生成する。
生成完了後、署名付き short-lived URL を返す (download は別 endpoint
`GET /v1/installations/{id}/exports/{opId}` で 24h 有効)。

> Current implementation: Accounts は request を受理し、
> `installation.export-requested` event を ledger に記録して 202 を返す。
> `PATCH /v1/installations/{id}/status` で `status=exported` と `operationId`
> を渡すと `installation.exported` event を append し、
> `GET /v1/installations/{id}/exports/{opId}` は completed operation を返す。
> `GET /v1/installations/{id}/exports/{opId}/download` は completed operation の
> `downloadUrl` へ expiry check 後に redirect する。 export bundle codec /
> import planner と metadata-only tar.zst archive writer は
> `takosumi.accounts.installation-export-bundle@v1` として実装済みです。
> configured export worker hook も実装済みで、Accounts は worker に canonical
> bundle を渡して operation を `exported` / `failed` に閉じられる。
> `takosumi-cloud accounts serve` の dev/local metadata export worker config
> も実装済みです。 data dump worker / age encryption / object-store upload
> は後続実装で行う。JSON bundle import API と
> `takosumi-git import <bundle.json|bundle.tar.zst>` は実装済みです。

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

| field                   | 注                                                           |
| ----------------------- | ------------------------------------------------------------ |
| `includeData`           | `false` → metadata のみ                                      |
| `format`                | `bundle` (tar.zst)                                           |
| `encryption.method`     | `none` / `age` (default 推奨)                                |
| `encryption.recipients` | `age` の場合必須                                             |
| `scope.data`            | 取得する data partition                                      |
| `scope.secrets`         | `templates-only` / `with-references` (secret 実値は出さない) |

### 5.2 Response (202)

```json
{
  "operationId": "op_01J...",
  "status": "preparing",
  "trackingUrl": "/v1/installations/inst_01J.../events?types=installation.export-requested,installation.exported,installation.export-failed",
  "downloadUrl": null,
  "downloadExpiresAt": null
}
```

完了通知は event list / poll で `installation.exported` event を受け取り、
`GET /v1/installations/{id}/exports/{opId}` から signed download URL
を取得する。`GET /v1/installations/{id}/exports/{opId}/download` は completed
operation の `downloadUrl` が未期限切れなら `302` で redirect する。未完了なら
`409 export_not_ready`、期限切れなら `410 export_download_expired` を返す。

Current Accounts service では `createAccountsHandler({ exportWorker })`
が設定されている 場合、`POST /export` は Accounts ledger から canonical bundle
を収集して worker に渡し、worker の `downloadUrl` を使って
`installation.exported` event を append する。外部 export worker / operator
が完了時に `PATCH /v1/installations/{id}/status`
へ以下を渡す経路も引き続きサポートする:

```json
{
  "status": "exported",
  "reason": "bundle ready",
  "operationId": "op_01J...",
  "downloadUrl": "https://...",
  "downloadExpiresAt": "2026-05-10T00:00:00.000Z"
}
```

同 patch は既存互換の `installation.status_changed` に加え、
`installation.exported` event を append する。`GET /exports/{opId}` はこの event
を読んで `status: "exported"` と download metadata を返す。 `operationId` 付き
completion / failure patch は必ず matching `installation.export-requested` event
を要求し、matching request がない場合または同 operation が既に closed の場合は
`409` を返す。

失敗時は `PATCH /status` に `status=failed`、`operation=export`、
`operationId`、`reason` を渡すと `installation.export-failed` event を append
し、 `GET /exports/{opId}` は `status: "failed"` と error metadata を返す。

### 5.3 Export bundle codec

Accounts の bundle payload kind は
`takosumi.accounts.installation-export-bundle@v1` です。codec は次を保持する:

- installation metadata (`installationId`, `accountId`, `spaceId`, `appId`,
  `mode`, `status`)
- source commit / ref / app manifest digest / compiled manifest digest
- service imports
- runtime binding ref
- OIDC client metadata
- AppBinding templates (config refs と secret ref names。secret 実値は含めない)
- active / revoked AppGrant metadata
- event hash refs

import planner は `{ bundle, targetIssuer, targetAccountId, targetSpaceId }`
を受け取り、`POST /v1/installations` に渡せる create request を生成する。
`identity.oidc@v1` の issuer は target issuer に置換され、revoked grant は
import request から除外される。これにより別 Takosumi Accounts instance /
self-host issuer へ移すときに、source Accounts issuer が OIDC materialization
output に残らない。

### 5.4 主なステータス

| code      | 条件                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 202       | 受理                                                                                                                                             |
| 400 / 422 | `invalid_request` / scope 不正                                                                                                                   |
| 403       | role / grant                                                                                                                                     |
| 404 / 410 | 既出                                                                                                                                             |
| 409       | `state_conflict` (canonical status が `installing` のとき、または operation metadata が in-flight phase を示すとき。詳細は [§0.5](#status-enum)) |

## 5.5 `POST /v1/installations/import`

export bundle を target Accounts instance の AppInstallation create request に
変換し、そのまま import する endpoint。tar.zst upload/parser は後続実装で、現
endpoint は `takosumi.accounts.installation-export-bundle@v1` JSON payload
を受け取る。

```http
POST /v1/installations/import HTTP/1.1
Authorization: Bearer <token>

{
  "bundle": {
    "kind": "takosumi.accounts.installation-export-bundle@v1",
    "version": "v1",
    "installation": { "...": "..." },
    "source": { "...": "..." },
    "bindings": [],
    "grants": []
  },
  "targetIssuer": "https://accounts.self-host.example",
  "targetAccountId": "acct_self_host",
  "targetSpaceId": "space_self_host",
  "targetInstallationId": "inst_imported",
  "createdBySubject": "tsub_owner"
}
```

| field                  | required | 説明                                                               |
| ---------------------- | -------- | ------------------------------------------------------------------ |
| `bundle`               | yes      | `takosumi.accounts.installation-export-bundle@v1` JSON payload     |
| `targetIssuer`         | no       | import 後の OIDC issuer。省略時は request を受けた Accounts issuer |
| `targetAccountId`      | yes      | import 先 account (`accountId` alias も可)                         |
| `targetSpaceId`        | yes      | import 先 space (`spaceId` alias も可)                             |
| `targetInstallationId` | no       | import 先 installation id (`installationId` alias も可)            |
| `createdBySubject`     | yes      | import 操作者 (`subject` alias も可)                               |
| `mode`                 | no       | `self-hosted` default。`dedicated` も許可                          |

Accounts は import planner を通して OIDC issuer を target issuer に rewrite し、
revoked grant を除外したうえで、`POST /v1/installations` と同じ create pipeline
を実行する。成功時は通常の AppInstallation envelope に `import_plan` を加えて
`202` を返し、`installation.import-planned` event を append する。

## 5.6 Cross-instance import flow

> **Implementation status**: kernel-bound manifest の `imports[]` /
> `serviceResolvers[]` validation、anchor fetch、signature verify、descriptor
> digest pinning は実装済みです。`POST /v1/installations/import` は JSON bundle
> payload を AppInstallation create request に変換するところまで実装済みです。
> `takosumi-git import <bundle>` も同 endpoint を呼ぶ current CLI bridge
> として実装済みです。本節の `requestedImports[]` を含む preview / install API
> の full materialization flow と export HTTP worker / data dump restore は継続
> work です。設計の正本は
> [architecture/cross-instance-service-binding](/architecture/cross-instance-service-binding)、
> manifest schema は
> [reference/manifest-spec § 14](/reference/manifest-spec#cross-instance-imports)
> を参照。

`POST /v1/install/preview` および `POST /v1/installations` の request body に
**`requestedImports[]`** field が追加されます。 forward 3-level dotted service
identifier で外部 service への接続を declare します。

### Request body 拡張 (preview / install 共通)

```json
{
  "source": {
    "type": "git",
    "url": "https://github.com/example/my-app",
    "ref": "v1.0.0"
  },
  "spaceId": "space_personal",
  "mode": "shared-cell",
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
      "url": "https://my-anchor.example.com/v1/services",
      "publicKey": "BASE64_ED25519_PUBLIC_KEY"
    }
  ]
}
```

| field              | required | type  | 説明                                                                     |
| ------------------ | -------- | ----- | ------------------------------------------------------------------------ |
| `requestedImports` | no       | array | service identifier import declaration (manifest `imports[]` と同 schema) |
| `serviceResolvers` | cond     | array | anchor pin (`requestedImports[]` を持つ install request では必須)        |

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

`POST /v1/installations` 受理後、takosumi-git installer pipeline は
`.takosumi/manifest.yml` に `imports[]` / `serviceResolvers[]` と resource spec
の `${imports.<alias>.endpoints.<role>.url}` reference を残した compiled
manifest を生成し、kernel `POST /v1/deployments` に渡す。kernel は apply 時に:

1. anchor から `ServiceDescriptor` を fetch
2. signature verify (invariant 16)
3. contract version pin
4. descriptor digest / provider instance / expiry を resource metadata / WAL に
   pin
5. `CrossInstanceShare` audit record を append
6. resource spec の `${imports.<alias>.endpoints.<role>.url}` placeholder を
   resolve

failure modes は `409 state_conflict` または `422 ..._resolution_failed` で
返される。

### Refresh / Revoke

- Refresh: anchor 経由で再 fetch、 `refreshPolicy.ttl` 内なら cached descriptor
  継続、 期限切れは新 Deployment が必要 (descriptor immutability)
- Revoke: AppGrant revoke 経路と統合 (詳細は
  [Layer A export](/platform/upgrade-export))

## 6. Cross-link

- [Install paths](/apps/install-paths) — Use Takos / Install from Git /
  Self-host の 3 path から本 API がどう呼ばれるか
- [Installer Pipeline](/architecture/installer-pipeline) —
  `POST /v1/installations` 受理後に takosumi-git が走らせる 13 step の詳細
- [Binding Catalog](/reference/binding-catalog) — `requestedBindings[].kind`
  に登場する AppBinding 型
- [`.takosumi/app.yml` Spec](/reference/app-yml-spec) — preview / install が
  parse する manifest 仕様
- [Launch Token](/apps/launch-token) — §3 で発行される JWS の format / 検証
- [Upgrade / Export](/platform/upgrade-export) — §5 export bundle の構造と
  self-host import 手順
- [Takosumi Accounts](/architecture/takosumi-accounts) — 認証 token の発行元

## 次に読むページ

- 開発者として API を叩くなら → [Install paths](/apps/install-paths)
- binding を追加 / 変更したいなら →
  [Binding Catalog](/reference/binding-catalog)
- export して self-host に移したいなら →
  [Upgrade / Export](/platform/upgrade-export)
- 用語の正本 → [Glossary](/reference/glossary)
