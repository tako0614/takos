# Binding Catalog

> **Canonical authority**: 本ページの **§8 Placeholder 解決順序** が manifest
> compile 時の placeholder resolution order の正本です。
> [reference/manifest-spec § 13](/reference/manifest-spec#compile-time-placeholders)
> は本 §8 への cross-ref であり、order を変更する場合は本ページを先に更新します。

`.takosumi/app.yml` の `bindings:` 節で宣言できる **binding type の正本
catalog** です。Installable App Model では binding は app が要求する
**resource 抽象型** を 7 種 (`service.import@v1` を含む) に固定し、
provision / inject / rotate / revoke / destroy の lifecycle を Takosumi Cloud
/ Takosumi Accounts / takosumi-git / anchor service の側が担います。

このページで依存してよい範囲:

- `.takosumi/app.yml` の `bindings.*.type` 値として使える 7 種の identifier
- 各 binding が compiled manifest 中で参照可能な `${bindings.<name>.*}` /
  `${secrets.<name>.*}` placeholder
- 各 binding が compiled manifest に既定で注入する env vars
- placeholder 解決順序 (canonical, 解決優先度順): `${params.*}` →
  `${installation.*}` → `${artifacts.*}` → `${bindings.*}` → `${secrets.*}`
  → `${env.*}` → `${refs.*}`

このページで依存してはいけない範囲:

- provider plugin (例: `@takos/managed-postgres`) の **内部実装**: backend の
  種類や物理 DB cluster 構成は private。本 catalog は **interface のみ**を
  contract 化する。
- Takosumi kernel 内部の resource shape (`database-postgres@v1` 等): kernel に
  渡る最終 manifest はすでに binding placeholder が解決済みで、kernel は
  binding を **知らない**。
- Takosumi Accounts の OIDC issuer 内部実装: `identity.oidc@v1` は consumer
  視点の interface のみを定義する (issuer 側 contract は
  [Takosumi Accounts](/architecture/takosumi-accounts) 参照)。

## 0. Catalog 一覧

| # | type identifier                  | domain             | 主担当                                | required env (default)                                                  |
| - | -------------------------------- | ------------------ | ------------------------------------- | ----------------------------------------------------------------------- |
| 1 | `identity.oidc@v1`               | identity           | Takosumi Accounts (OIDC issuer)       | `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` |
| 2 | `database.postgres@v1`           | data plane         | takosumi-cloud managed-postgres       | `DATABASE_URL`                                                          |
| 3 | `object-store.s3-compatible@v1`  | data plane         | takosumi-cloud managed-object-store   | `BLOB_ENDPOINT` / `BLOB_BUCKET` / `BLOB_ACCESS_KEY` / `BLOB_SECRET_KEY` |
| 4 | `domain.http@v1`                 | network            | takosumi-cloud domain manager + DNS   | (env 注入なし。`${bindings.<name>.url}` を manifest 側で参照)            |
| 5 | `deploy-intent.gitops@v1`        | deploy bridge      | takosumi-git deploy intent repo        | `DEPLOY_INTENT_DRIVER` / `DEPLOY_INTENT_REMOTE` / `DEPLOY_INTENT_TOKEN` |
| 6 | `install-launch-token@v1`        | identity bootstrap | Takosumi Accounts (launch token issuer) | `INSTALL_LAUNCH_PUBLIC_KEY` / `INSTALL_LAUNCH_AUDIENCE`                 |
| 7 | `service.import@v1`               | cross-instance binding | anchor (operator-injected) + provider via `ServiceDescriptor` | (env は import alias / endpoint role 単位で manifest 側に明示)             |

binding type identifier の文法:

```
<domain>.<kind>@v<major>
```

- `<domain>` / `<kind>` は lowercase kebab-case (`identity`, `database`,
  `object-store`, `domain`, `deploy-intent`, `install-launch-token`)
- `@v<major>` は単一 integer。breaking change のみ bump

catalog にない type を `bindings.*.type` に書くと
[install preview](/reference/install-api#post-v1install-preview) が
`422 manifest-compile-failed` を返します。

## 1. `identity.oidc@v1`

AppInstallation 単位で OIDC client を Takosumi Accounts に登録し、Takos が
[OIDC consumer](/apps/oidc-consumer) として login を実装するための binding。

### 1.1 Request fields (`.takosumi/app.yml`)

| field                    | required | type                | 説明                                                                |
| ------------------------ | -------- | ------------------- | ------------------------------------------------------------------- |
| `type`                   | yes      | const               | `"identity.oidc@v1"`                                                |
| `required`               | no       | boolean             | default `true`                                                      |
| `redirectPaths`          | yes      | string[] (path)     | AppInstallation の base URL に append される。例: `/auth/oidc/callback` |
| `allowedScopes`          | no       | string[]            | default `["openid", "email", "profile"]`                            |
| `subjectMode`            | no       | const               | `"pairwise"` 固定 (public は採用しない)                             |
| `tokenEndpointAuthMethod`| no       | enum                | `client_secret_basic` (default) / `client_secret_post` / `private_key_jwt` |

### 1.2 Provisioned config

provider が `provision` 後に AppBinding として永続化する fields:

| field                    | 説明                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `issuerUrl`              | example: `https://accounts.takosumi.cloud` (anchor 経由 resolve、 operator-injected hostname、 詳細は [cross-instance service binding](/architecture/cross-instance-service-binding)) |
| `clientId`               | installation 単位で発行された OIDC client id (例: `takos_inst_abc`) |
| `redirectUris`           | 解決済み absolute URI 配列                                        |
| `allowedScopes`          | request の `allowedScopes` を継承                                 |
| `subjectMode`            | `"pairwise"` 固定                                                 |
| `tokenEndpointAuthMethod`| 認証 method 名                                                    |

secret は Vault path として `clientSecretRef` のみ持ち、生 secret は
compile 時に解決される。

### 1.3 Output placeholders

| placeholder                          | 値                                                       |
| ------------------------------------ | -------------------------------------------------------- |
| `${bindings.<name>.issuerUrl}`       | `config.issuerUrl`                                       |
| `${bindings.<name>.clientId}`        | `config.clientId`                                        |
| `${bindings.<name>.redirectUri}`     | `config.redirectUris[0]` (multi 時 `redirectUris[i]` 参照可) |
| `${secrets.<name>.clientSecret}`     | Vault から解決された生 secret                            |

### 1.4 Default env injection

manifest 中で `env:` を明示しなかった場合に注入される:

```env
OIDC_ISSUER_URL    = ${bindings.<name>.issuerUrl}
OIDC_CLIENT_ID     = ${bindings.<name>.clientId}
OIDC_REDIRECT_URI  = ${bindings.<name>.redirectUri}
OIDC_CLIENT_SECRET = ${secrets.<name>.clientSecret}
```

`AUTH_DRIVER=oidc` は app 側 contract として manifest で別途設定する。

### 1.5 例

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
    allowedScopes: [openid, email, profile]
    subjectMode: pairwise
```

## 2. `database.postgres@v1`

managed PostgreSQL database を AppInstallation 専用に provision する binding。

### 2.1 Request fields

| field                  | required | type    | 説明                                                              |
| ---------------------- | -------- | ------- | ----------------------------------------------------------------- |
| `type`                 | yes      | const   | `"database.postgres@v1"`                                          |
| `required`             | no       | boolean | default `true`                                                    |
| `plan`                 | yes      | enum    | `nano` / `small` / `medium` / `large` / `xlarge`                  |
| `region`               | no       | string  | 省略時 AppInstallation の region 継承                             |
| `version`              | no       | enum    | `"15"` / `"16"` (default) / `"17"`                                |
| `extensions`           | no       | string[]| whitelist: `pgvector` / `pgcrypto` / `uuid-ossp` / `pg_stat_statements` / `pg_trgm` |
| `highAvailability`     | no       | boolean | default `false`                                                   |
| `backupRetentionDays`  | no       | int     | 1..35, default `7`                                                |

`extensions` は **whitelist のみ**。任意 extension は受け付けない。

### 2.2 Provisioned config

`plan` / `region` / `version` / `host` / `port` (default `5432`) /
`database` / `username` / `extensions` / `sslMode` (`require` / `verify-full`、
default `require`) / `highAvailability` を持つ。secret は `passwordRef`
(Vault path)。

### 2.3 Output placeholders

| placeholder                       | 値                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------- |
| `${bindings.<name>.host}`         | `config.host`                                                                     |
| `${bindings.<name>.port}`         | `config.port`                                                                     |
| `${bindings.<name>.database}`     | `config.database`                                                                 |
| `${bindings.<name>.username}`     | `config.username`                                                                 |
| `${bindings.<name>.sslMode}`      | `config.sslMode`                                                                  |
| `${bindings.<name>.url}`          | derived: `postgres://<user>:<password>@<host>:<port>/<db>?sslmode=<sslMode>`      |
| `${secrets.<name>.password}`      | Vault から解決された生 password                                                   |

### 2.4 Default env injection

```env
DATABASE_URL = ${bindings.<name>.url}
```

### 2.5 例

```yaml
bindings:
  db:
    type: database.postgres@v1
    plan: small
    region: ap-tokyo-1
    version: "16"
    extensions: [pgvector]
    backupRetentionDays: 14
```

## 3. `object-store.s3-compatible@v1`

S3-compatible object storage の bucket を AppInstallation に provision する
binding。MinIO / S3 / R2 などを provider plugin で吸収する。

### 3.1 Request fields

| field           | required | type    | 説明                                                                       |
| --------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `type`          | yes      | const   | `"object-store.s3-compatible@v1"`                                          |
| `required`      | no       | boolean | default `true`                                                             |
| `plan`          | yes      | enum    | `standard` / `infrequent-access` / `archive`                               |
| `region`        | no       | string  | AppInstallation 継承可                                                     |
| `encryption`    | no       | object  | `{ mode: "sse-s3" \| "sse-kms", kmsKeyRef?: vault-uri }` (default sse-s3)  |
| `versioning`    | no       | boolean | default `true`                                                             |
| `lifecycleDays` | no       | int     | 0 = 無効 (default)                                                         |

`encryption.mode == "sse-kms"` のときのみ `kmsKeyRef` 必須。

### 3.2 Provisioned config

`plan` / `region` / `endpoint` (S3 API URL) / `bucket` (3..63 chars) /
`accessKeyId` / `encryption` / `versioning` を持つ。secret は
`secretAccessKeyRef` (Vault path)。

### 3.3 Output placeholders

| placeholder                       | 値                                  |
| --------------------------------- | ----------------------------------- |
| `${bindings.<name>.endpoint}`     | `config.endpoint`                   |
| `${bindings.<name>.bucket}`       | `config.bucket`                     |
| `${bindings.<name>.accessKey}`    | `config.accessKeyId`                |
| `${bindings.<name>.region}`       | `config.region`                     |
| `${secrets.<name>.secretKey}`     | Vault から解決された secret access key |

### 3.4 Default env injection

```env
BLOB_ENDPOINT   = ${bindings.<name>.endpoint}
BLOB_BUCKET     = ${bindings.<name>.bucket}
BLOB_ACCESS_KEY = ${bindings.<name>.accessKey}
BLOB_SECRET_KEY = ${secrets.<name>.secretKey}
```

### 3.5 例

```yaml
bindings:
  blob:
    type: object-store.s3-compatible@v1
    plan: standard
    region: ap-tokyo-1
    encryption:
      mode: sse-s3
    versioning: true
```

## 4. `domain.http@v1`

AppInstallation に **HTTP/HTTPS で reachable な hostname** を provision する
binding。auto subdomain (`<inst-slug>.takosumi.app`) と custom hostname の
両方をサポートする。

### 4.1 Request fields

| field                  | required | type        | 説明                                                                        |
| ---------------------- | -------- | ----------- | --------------------------------------------------------------------------- |
| `type`                 | yes      | const       | `"domain.http@v1"`                                                          |
| `required`             | no       | boolean     | default `true`                                                              |
| `hostname`             | yes      | enum/object | `"auto"` または `{ custom: "chat.example.com" }`                            |
| `tlsMode`              | no       | enum        | `auto` (default) / `managed` / `byo`                                        |
| `tlsCertRef`           | cond     | vault-uri   | `tlsMode=byo` のとき必須                                                    |
| `redirectHttpToHttps`  | no       | boolean     | default `true`                                                              |

### 4.2 Provisioned config

`hostname` / `url` (= `https://<hostname>`) / `tlsMode` /
`tlsCertFingerprint` (SHA-256 of leaf cert) / `isCustom` /
`verificationStatus` (`pending` / `verified` / `failed`) を持つ。

### 4.3 Output placeholders

| placeholder                    | 値                  |
| ------------------------------ | ------------------- |
| `${bindings.<name>.hostname}`  | `config.hostname`   |
| `${bindings.<name>.url}`       | `config.url`        |

### 4.4 Default env injection

domain binding は **env を default 注入しない**。app は manifest 中で明示する:

```yaml
env:
  BASE_URL: "${bindings.domain.url}"
```

### 4.5 例

```yaml
# auto subdomain
bindings:
  domain:
    type: domain.http@v1
    hostname: auto
    tlsMode: auto
```

```yaml
# custom hostname
bindings:
  domain:
    type: domain.http@v1
    hostname:
      custom: chat.example.com
    tlsMode: managed
```

[materialize](/platform/upgrade-export#materialize) は **hostname を変えない**
ことを保証する (routing target だけ shared-cell から dedicated に切り替える)。

## 5. `deploy-intent.gitops@v1`

Takos が deploy 操作を行いたいときに、**takosumi kernel API を直接叩かず、
Git repo に manifest fragment を commit する** ための binding。
takosumi-git が repo を watch して workflow 実行 → kernel apply。

### 5.1 Request fields

| field             | required | type      | 説明                                                                       |
| ----------------- | -------- | --------- | -------------------------------------------------------------------------- |
| `type`            | yes      | const     | `"deploy-intent.gitops@v1"`                                                |
| `required`        | no       | boolean   | default `false`                                                            |
| `branch`          | no       | string    | default `main`                                                             |
| `remoteUrl`       | no       | uri       | 省略時 takosumi-git が自動 provision                                       |
| `tokenRef`        | no       | vault-uri | 省略時 自動発行                                                            |
| `writePathPrefix` | no       | string    | default `deployments/`。app が manifest fragment を書ける repo 内 path prefix |

### 5.2 Provisioned config

`driver: "gitops"` 固定 / `remoteUrl` / `branch` / `writePathPrefix` /
`watcherInstallationId` (watcher が動く installation id) を持つ。secret は
`tokenRef`。

token は `writePathPrefix` 配下にのみ push 可能な scoped Git token。

### 5.3 Output placeholders

| placeholder                                | 値                |
| ------------------------------------------ | ----------------- |
| `${bindings.<name>.driver}`                | `"gitops"` 固定   |
| `${bindings.<name>.remote}`                | `config.remoteUrl`|
| `${bindings.<name>.branch}`                | `config.branch`   |
| `${bindings.<name>.writePathPrefix}`       | `config.writePathPrefix` |
| `${secrets.<name>.token}`                  | Vault 解決された scoped token |

### 5.4 Default env injection

```env
DEPLOY_INTENT_DRIVER = gitops
DEPLOY_INTENT_REMOTE = ${bindings.<name>.remote}
DEPLOY_INTENT_TOKEN  = ${secrets.<name>.token}
```

`branch` / `writePathPrefix` を app が必要とする場合は manifest 中で明示する。

### 5.5 例

```yaml
bindings:
  deploy:
    type: deploy-intent.gitops@v1
    required: false
    branch: main
    writePathPrefix: deployments/
```

セキュリティ要件:

- token は `writePathPrefix` 配下にのみ push 可能 (server-side path-based ACL)
- workflow run は budget guard を必ず通過
- workflow が触れる kernel resource は AppInstallation の grant
  `deploy.intent.write` に制限

## 6. `install-launch-token@v1`

install 完了直後の自動 sign-in 用 [launch token JWS](/apps/launch-token) を
**検証する側 (= app)** に必要な公開鍵 / audience を提供する binding。

実際の token 発行は Takosumi Accounts
(`POST /v1/installations/{id}/launch-token`、
[Install API](/reference/install-api#launch-token) 参照) が担い、本 binding は
**検証材料の注入のみ**を担当する。

### 6.1 Request fields

| field                | required | type    | 説明                                                                       |
| -------------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `type`               | yes      | const   | `"install-launch-token@v1"`                                                |
| `required`           | no       | boolean | default `true`                                                             |
| `consumePath`        | no       | path    | default `/_takosumi/launch`                                                |
| `maxLifetimeSeconds` | no       | int     | 30..300 (hard cap 5 分), default `300`                                     |

### 6.2 Provisioned config

| field                | 説明                                                              |
| -------------------- | ----------------------------------------------------------------- |
| `audience`           | JWS aud claim。通常は `appId` (例: `takos.chat`)                  |
| `publicKey`          | PEM-encoded Ed25519 (or RSA) public key                           |
| `algorithm`          | `EdDSA` または `RS256`                                            |
| `kid`                | key id                                                            |
| `consumePath`        | request の `consumePath` を継承                                   |
| `maxLifetimeSeconds` | 上限 lifetime                                                     |

token 発行側の **private key は本 binding には含めない** (Takosumi Accounts
内部に保持)。secret schema は **空** (本 binding は public key と audience の
みを扱う)。

### 6.3 Output placeholders

| placeholder                            | 値                       |
| -------------------------------------- | ------------------------ |
| `${bindings.<name>.publicKey}`         | PEM 公開鍵               |
| `${bindings.<name>.audience}`          | aud 値                   |
| `${bindings.<name>.algorithm}`         | `EdDSA` / `RS256`        |
| `${bindings.<name>.kid}`               | key id                   |
| `${bindings.<name>.consumePath}`       | consume endpoint path    |

### 6.4 Default env injection

```env
INSTALL_LAUNCH_PUBLIC_KEY = ${bindings.<name>.publicKey}
INSTALL_LAUNCH_AUDIENCE   = ${bindings.<name>.audience}
```

> Note: app 側 verifier は [`INSTALL_LAUNCH_ISSUER`](/apps/launch-token#検証用-environment)
> も要求する ([Launch Token](/apps/launch-token) §6 参照)。本 binding は現状
> `issuer` を Provisioned config として expose しないため、`INSTALL_LAUNCH_ISSUER`
> は manifest 中で `OIDC_ISSUER_URL` と同じ値、または期待する Takosumi Accounts
> issuer を **手動で env config** する。将来 binding に `issuer` field が追加
> されたら default injection に組み込む。

### 6.5 例

```yaml
bindings:
  bootstrap:
    type: install-launch-token@v1
    required: true
    consumePath: /_takosumi/launch
    maxLifetimeSeconds: 300
```

## 7. `service.import@v1`

> **Implementation status**: `.takosumi/app.yml` parser / binding catalog /
> AppInstallation ledger / kernel manifest schema / consumer-side anchor
> resolution は `service.import@v1` を受け付けます。provider-side publish
> automation、cached refresh / revoke、実 placeholder materialization は
> 継続 work です。設計の正本は
> [architecture/cross-instance-service-binding](/architecture/cross-instance-service-binding)、
> service identifier 形式の formal spec は
> [reference/service-identifier-spec](/reference/service-identifier-spec) を
> 参照。

外部 takosumi instance (別 deployment / 別 operator / 別 cloud) の service
を **forward 3-level dotted service identifier** (`<ecosystem>.<area>.<function>@<ver>`、
例 `takosumi.account.auth@v1`) で manifest から参照し、 anchor (operator-injected
service resolver) 経由で provider-signed `ServiceDescriptor` を fetch、
endpoints を env / config に inject するための binding kind です。

### 7.1 manifest top-level field との関係

`service.import@v1` 単独では機能しません。 consumer manifest で以下 2 field
を併用します:

- `serviceResolvers[]` — anchor URL を 1 個以上 pin、 各 anchor の signature
  verify 用 `publicKey` を含む
- `imports[]` — service identifier (`service: takosumi.account.auth@v1`) と
  alias / refreshPolicy を declare

詳細は [reference/manifest-spec § 14](/reference/manifest-spec#cross-instance-imports)
を参照。

### 7.2 Request fields (`.takosumi/app.yml`)

| field           | required | type    | 説明                                                                       |
| --------------- | -------- | ------- | -------------------------------------------------------------------------- |
| `type`          | yes      | const   | `"service.import@v1"`                                                      |
| `required`      | no       | boolean | default `true`                                                             |
| `service`       | yes      | string  | service identifier (`<ecosystem>.<area>.<function>@<ver>`)                 |
| `alias`         | no       | string  | manifest 内 alias (default = binding name)                                 |
| `endpointRoles` | yes      | string[] | 必要な endpoint role list (例 `["oidc-issuer", "install-launch"]`)        |
| `refreshPolicy` | no       | object  | `{ kind: "ttl", ttl: "300s" }` 等。 default は anchor の `expiresAt` に従う |

### 7.3 Provisioned config

provider が anchor に publish した `ServiceDescriptor` から resolve される
field:

| field                    | 説明                                                              |
| ------------------------ | ----------------------------------------------------------------- |
| `serviceId`              | manifest と同じ `<ecosystem>.<area>.<function>@<ver>` |
| `endpoints[<role>].url`  | provider deploy 時に operator URL で resolved した endpoint URL   |
| `endpoints[<role>].path` | endpoint path                                                     |
| `metadata`               | service-specific capability flag (例 `pairwiseSubjectMode: true`) |
| `providerInstance`       | provider deployment id (audit 用)                                 |
| `expiresAt`              | descriptor TTL (refresh trigger)                                  |

`signature` / `publishedAt` は kernel が verify / pin する内部 metadata で、
binding output には expose されません。

### 7.4 Output placeholders

| placeholder                                            | 値                                              |
| ------------------------------------------------------ | ----------------------------------------------- |
| `${bindings.<name>.endpoints.<role>.url}`              | endpoint role の URL                            |
| `${bindings.<name>.endpoints.<role>.path}`             | endpoint role の path                           |
| `${bindings.<name>.metadata.<key>}`                    | service metadata の任意 key                     |
| `${bindings.<name>.serviceId}`                         | service identifier (例 `takosumi.account.auth@v1`) |

`${secrets.<name>.*}` は本 binding では発行しません (provider-side credentials
は本 binding の責務外、 OIDC 等の認証は別 binding chain で扱う)。

### 7.5 Default env injection

本 binding は **env を default 注入しません**。 app は manifest 中で必要な
endpoint role を明示します:

```yaml
env:
  OIDC_ISSUER_URL:        "${bindings.account-auth.endpoints.oidc-issuer.url}"
  OIDC_INSTALL_LAUNCH_URL: "${bindings.account-auth.endpoints.install-launch.url}"
  OIDC_JWKS_URL:           "${bindings.account-auth.endpoints.jwks.url}"
```

これは旧 `identity.oidc@v1` の Default env injection と異なり、 endpoint role
ごとの参照を明示する設計です (cross-instance 接続では provider が export する
endpoint role 数が動的に変わるため)。

### 7.6 例

```yaml
bindings:
  account-auth:
    type: service.import@v1
    required: true
    service: takosumi.account.auth@v1
    endpointRoles:
      - oidc-issuer
      - install-launch
      - jwks
    refreshPolicy:
      kind: ttl
      ttl: 300s

  account-billing:
    type: service.import@v1
    required: false
    service: takosumi.account.billing@v1
    endpointRoles:
      - webhook
      - subscription-api
```

manifest top-level field との対応 (consumer 側 manifest 全体は
[architecture/takosumi-cloud § 3](/architecture/takosumi-cloud#_3-consumer-側-takos-product-manifest-sample) を
参照):

```yaml
serviceResolvers:
  - kind: anchor
    url: https://my-anchor.example.com/v1/services/
    publicKey: ${secrets.anchor-publickey}

imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
    refreshPolicy:
      kind: ttl
      ttl: 300s
```

### 7.7 セキュリティ要件

- anchor `publicKey` は consumer manifest の `serviceResolvers[].publicKey`
  で pin (signed-descriptor trust)
- kernel が apply 時に `ServiceDescriptor.signature` を verify (invariant 16)
- public deploy route は descriptor digest / provider instance / expiry を
  `ManifestResource.metadata.takosumiServiceImports` に pin する。full
  descriptor closure / durable share ledger は継続 work
- contract version skew (manifest `@v1` ≠ descriptor version) は apply
  reject
- anchor unreachable 時は現状 apply reject。cached descriptor 継続と degraded
  continuation は refresh/revoke track
- success path は transient `CrossInstanceShare.auditTrail` を作る。失敗事例の
  durable append-only audit は継続 work

## 8. Placeholder 解決順序

manifest compile 時 (= takosumi-git installer pipeline) に解決される
placeholder の優先順位:

1. `${params.*}` — install API の `params` 引数
2. `${installation.*}` — `id` / `accountId` / `spaceId` / `baseUrl`
3. `${artifacts.*}` — workflow run の output (image digest 等)
4. `${bindings.<name>.*}` — 本 catalog の Output placeholders
5. `${secrets.<name>.*}` — Vault 解決
6. `${env.*}` — runtime 起動時の env (compile 時には残置)
7. `${refs.*.outputs.*}` — kernel resource 間の依存 (kernel が apply 時に解決)

`${refs.*.outputs.*}` は kernel が apply 時に解決するため compiled manifest
にそのまま残るが、それ以外 (1〜5) は **compile 時に全消去** される
invariant。`${env.*}` は app 自身の dynamic env への参照として残置される
余地がある (descriptor が許す範囲)。

### 7.1 名前衝突の禁止

同一 `.takosumi/app.yml` 内で同じ binding name (`bindings.<name>`) を 2 回
宣言することは禁止。schema validation で検出する。

### 7.2 default env injection の override

各 binding の Default env injection は、manifest 中の compute resource が
`env:` を **明示しなかった** key にのみ適用される。明示時はそのまま採用
(compile 時 placeholder は通常通り解決)。

### 7.3 required vs optional

`request.required: false` の binding が provision されなかった場合、
compiled manifest 中の `${bindings.<name>.*}` / `${secrets.<name>.*}` /
default env injection はすべて **空文字列に解決されず compile error** とする。

required false binding を runtime で扱いたい app は、`.takosumi/app.yml`
側で env を分岐定義するか、別 manifest variant を持つ。

## 9. 参照される manifest snippet

[`.takosumi/app.yml`](/reference/app-yml-spec) の `bindings:` 節と
[`.takosumi/manifest.yml`](/deploy/manifest) の placeholder 参照は次のように
対応する。

```yaml
# .takosumi/app.yml (installer-bound)
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback
  db:
    type: database.postgres@v1
    plan: small
  blob:
    type: object-store.s3-compatible@v1
    plan: standard
  domain:
    type: domain.http@v1
    hostname: auto
  bootstrap:
    type: install-launch-token@v1
    required: true
```

```yaml
# .takosumi/manifest.yml (kernel-bound, takosumi-git が compile)
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/kubernetes-deployment"
    spec:
      image: "${artifacts.api.image}"
      env:
        AUTH_DRIVER: "oidc"
        OIDC_ISSUER_URL: "${bindings.auth.issuerUrl}"
        OIDC_CLIENT_ID:  "${bindings.auth.clientId}"
        OIDC_CLIENT_SECRET: "${secrets.auth.clientSecret}"
        OIDC_REDIRECT_URI:  "${bindings.auth.redirectUri}"
        DATABASE_URL: "${bindings.db.url}"
        BLOB_ENDPOINT:   "${bindings.blob.endpoint}"
        BLOB_BUCKET:     "${bindings.blob.bucket}"
        BLOB_ACCESS_KEY: "${bindings.blob.accessKey}"
        BLOB_SECRET_KEY: "${secrets.blob.secretKey}"
        BASE_URL:        "${bindings.domain.url}"
        TAKOS_INSTALLATION_ID: "${installation.id}"
        INSTALL_LAUNCH_PUBLIC_KEY: "${bindings.bootstrap.publicKey}"
        INSTALL_LAUNCH_AUDIENCE:   "${bindings.bootstrap.audience}"
```

## 次に読むページ

- [`.takosumi/app.yml` Spec](/reference/app-yml-spec) — binding declaration の
  parent schema
- [Install API](/reference/install-api) — `POST /v1/installations` body の
  `bindings` field と本 catalog の対応
- [Installer Pipeline](/architecture/installer-pipeline) — binding 解決と
  manifest compile の詳細フロー
- [Takosumi Accounts](/architecture/takosumi-accounts) — `identity.oidc@v1` /
  `install-launch-token@v1` の issuer 側 contract
- [OIDC Consumer](/apps/oidc-consumer) — Takos 側で OIDC binding を消費する
  実装
- [Glossary](/reference/glossary) — Installable App Model 用語の正本
