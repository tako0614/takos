# Binding Catalog

> **Canonical authority**: 本ページの **§8 Placeholder 解決順序** が
> installer-only placeholder contract の正本です。
> [reference/manifest-spec § 13](/reference/manifest-spec#compile-time-placeholders)
> は本 §8 への cross-ref であり、order
> を変更する場合は本ページを先に更新します。

`.takosumi/app.yml` の `bindings:` 節で宣言できる **binding type の正本
catalog** です。Installable App Model では binding は app が要求する **resource
抽象型** を 6 種に固定し、provision / inject / rotate / revoke / destroy の
lifecycle を Takosumi Cloud / Takosumi Accounts / takosumi-git の側が
担います。Cross-instance service dependency は AppBinding ではなく
`.takosumi/manifest.yml` の `imports[]` / `serviceResolvers[]` で表現します。

このページで依存してよい範囲:

- `.takosumi/app.yml` の `bindings.*.type` 値として使える 6 種の identifier
- 各 binding materializer が authoring `.takosumi/manifest.yml` の compile 前に
  提供できる `${bindings.<name>.*}` / `${secrets.<name>.*}` reserved placeholder
  vocabulary
- 各 binding が compiled manifest に実値として提供する env vars
- placeholder 解決順序 (canonical, 解決優先度順): `${params.*}` →
  `${installation.*}` → `${artifacts.*}` → `${bindings.*}` → `${secrets.*}` →
  `${env.*}` → kernel-bound references (`${ref:...}` / `${secret-ref:...}` /
  `${imports...}`)

Current `takosumi-git` compiler enforces the boundary conservatively: if
`${params.*}`, `${installation.*}`, `${artifacts.*}`, `${bindings.*}`,
`${secrets.*}`, or legacy `${refs.*}` remains unresolved after service-import
compilation, the command fails before Accounts / kernel requests. `${imports.*}`
may remain because the kernel public deploy route resolves it.

The output placeholder tables and "Default env injection" snippets below are the
account-plane materializer contract. They are not a promise that the standalone
compiler will invent values when no materializer supplied them.

このページで依存してはいけない範囲:

- provider plugin (例: `@takos/managed-postgres`) の **内部実装**: backend の
  種類や物理 DB cluster 構成は private。本 catalog は **interface のみ**を
  contract 化する。
- Takosumi kernel 内部の resource shape (`database-postgres@v1` 等): kernel に
  渡る最終 manifest は unresolved binding placeholder を含まず、kernel は
  binding を **知らない**。
- Takosumi Accounts の OIDC issuer 内部実装: `identity.oidc@v1` は consumer
  視点の interface のみを定義する (issuer 側 contract は
  [Takosumi Accounts](/architecture/takosumi-accounts) 参照)。

## 0. Catalog 一覧

| # | type identifier                 | domain             | 主担当                                  | required env (default)                                                            |
| - | ------------------------------- | ------------------ | --------------------------------------- | --------------------------------------------------------------------------------- |
| 1 | `identity.oidc@v1`              | identity           | Takosumi Accounts (OIDC issuer)         | `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` |
| 2 | `database.postgres@v1`          | data plane         | takosumi-cloud managed-postgres         | `DATABASE_URL`                                                                    |
| 3 | `object-store.s3-compatible@v1` | data plane         | takosumi-cloud managed-object-store     | `BLOB_ENDPOINT` / `BLOB_BUCKET` / `BLOB_ACCESS_KEY` / `BLOB_SECRET_KEY`           |
| 4 | `domain.http@v1`                | network            | takosumi-cloud domain manager + DNS     | (env 注入なし。`${bindings.<name>.url}` を manifest 側で参照)                     |
| 5 | `deploy-intent.gitops@v1`       | deploy bridge      | takosumi-git deploy intent repo         | `DEPLOY_INTENT_DRIVER` / `DEPLOY_INTENT_REMOTE` / `DEPLOY_INTENT_TOKEN`           |
| 6 | `install-launch-token@v1`       | identity bootstrap | Takosumi Accounts (launch token issuer) | `INSTALL_LAUNCH_PUBLIC_KEY` / `INSTALL_LAUNCH_AUDIENCE`                           |

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

| field                     | required | type            | 説明                                                                       |
| ------------------------- | -------- | --------------- | -------------------------------------------------------------------------- |
| `type`                    | yes      | const           | `"identity.oidc@v1"`                                                       |
| `required`                | no       | boolean         | default `true`                                                             |
| `redirectPaths`           | yes      | string[] (path) | AppInstallation の base URL に append される。例: `/auth/oidc/callback`    |
| `allowedScopes`           | no       | string[]        | default `["openid", "email", "profile"]`                                   |
| `subjectMode`             | no       | const           | `"pairwise"` 固定 (public は採用しない)                                    |
| `tokenEndpointAuthMethod` | no       | enum            | `client_secret_basic` (default) / `client_secret_post` / `private_key_jwt` |

### 1.2 Provisioned config

provider が `provision` 後に AppBinding として永続化する fields:

| field                     | 説明                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `issuerUrl`               | operator-injected issuer URL resolved through the `takosumi.account.auth@v1` service identifier and anchor (詳細は [cross-instance service binding](/architecture/cross-instance-service-binding)) |
| `clientId`                | installation 単位で発行された OIDC client id (例: `takos_inst_abc`)                                                                                                                                |
| `redirectUris`            | 解決済み absolute URI 配列                                                                                                                                                                         |
| `allowedScopes`           | request の `allowedScopes` を継承                                                                                                                                                                  |
| `subjectMode`             | `"pairwise"` 固定                                                                                                                                                                                  |
| `tokenEndpointAuthMethod` | 認証 method 名                                                                                                                                                                                     |

secret は Vault path として `clientSecretRef` のみ持ち、生 secret は compile
時に解決される。

### 1.3 Output placeholders

| placeholder                      | 値                                                           |
| -------------------------------- | ------------------------------------------------------------ |
| `${bindings.<name>.issuerUrl}`   | `config.issuerUrl`                                           |
| `${bindings.<name>.clientId}`    | `config.clientId`                                            |
| `${bindings.<name>.redirectUri}` | `config.redirectUris[0]` (multi 時 `redirectUris[i]` 参照可) |
| `${secrets.<name>.clientSecret}` | Vault から解決された生 secret                                |

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

| field                 | required | type     | 説明                                                                                |
| --------------------- | -------- | -------- | ----------------------------------------------------------------------------------- |
| `type`                | yes      | const    | `"database.postgres@v1"`                                                            |
| `required`            | no       | boolean  | default `true`                                                                      |
| `plan`                | yes      | enum     | `nano` / `small` / `medium` / `large` / `xlarge`                                    |
| `region`              | no       | string   | 省略時 AppInstallation の region 継承                                               |
| `version`             | no       | enum     | `"15"` / `"16"` (default) / `"17"`                                                  |
| `extensions`          | no       | string[] | whitelist: `pgvector` / `pgcrypto` / `uuid-ossp` / `pg_stat_statements` / `pg_trgm` |
| `highAvailability`    | no       | boolean  | default `false`                                                                     |
| `backupRetentionDays` | no       | int      | 1..35, default `7`                                                                  |

`extensions` は **whitelist のみ**。任意 extension は受け付けない。

### 2.2 Provisioned config

`plan` / `region` / `version` / `host` / `port` (default `5432`) / `database` /
`username` / `extensions` / `sslMode` (`require` / `verify-full`、 default
`require`) / `highAvailability` を持つ。secret は `passwordRef` (Vault path)。

### 2.3 Output placeholders

| placeholder                   | 値                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `${bindings.<name>.host}`     | `config.host`                                                                |
| `${bindings.<name>.port}`     | `config.port`                                                                |
| `${bindings.<name>.database}` | `config.database`                                                            |
| `${bindings.<name>.username}` | `config.username`                                                            |
| `${bindings.<name>.sslMode}`  | `config.sslMode`                                                             |
| `${bindings.<name>.url}`      | derived: `postgres://<user>:<password>@<host>:<port>/<db>?sslmode=<sslMode>` |
| `${secrets.<name>.password}`  | Vault から解決された生 password                                              |

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

| field           | required | type    | 説明                                                                      |
| --------------- | -------- | ------- | ------------------------------------------------------------------------- |
| `type`          | yes      | const   | `"object-store.s3-compatible@v1"`                                         |
| `required`      | no       | boolean | default `true`                                                            |
| `plan`          | yes      | enum    | `standard` / `infrequent-access` / `archive`                              |
| `region`        | no       | string  | AppInstallation 継承可                                                    |
| `encryption`    | no       | object  | `{ mode: "sse-s3" \| "sse-kms", kmsKeyRef?: vault-uri }` (default sse-s3) |
| `versioning`    | no       | boolean | default `true`                                                            |
| `lifecycleDays` | no       | int     | 0 = 無効 (default)                                                        |

`encryption.mode == "sse-kms"` のときのみ `kmsKeyRef` 必須。

### 3.2 Provisioned config

`plan` / `region` / `endpoint` (S3 API URL) / `bucket` (3..63 chars) /
`accessKeyId` / `encryption` / `versioning` を持つ。secret は
`secretAccessKeyRef` (Vault path)。

### 3.3 Output placeholders

| placeholder                    | 値                                     |
| ------------------------------ | -------------------------------------- |
| `${bindings.<name>.endpoint}`  | `config.endpoint`                      |
| `${bindings.<name>.bucket}`    | `config.bucket`                        |
| `${bindings.<name>.accessKey}` | `config.accessKeyId`                   |
| `${bindings.<name>.region}`    | `config.region`                        |
| `${secrets.<name>.secretKey}`  | Vault から解決された secret access key |

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

| field                 | required | type        | 説明                                             |
| --------------------- | -------- | ----------- | ------------------------------------------------ |
| `type`                | yes      | const       | `"domain.http@v1"`                               |
| `required`            | no       | boolean     | default `true`                                   |
| `hostname`            | yes      | enum/object | `"auto"` または `{ custom: "chat.example.com" }` |
| `tlsMode`             | no       | enum        | `auto` (default) / `managed` / `byo`             |
| `tlsCertRef`          | cond     | vault-uri   | `tlsMode=byo` のとき必須                         |
| `redirectHttpToHttps` | no       | boolean     | default `true`                                   |

### 4.2 Provisioned config

`hostname` / `url` (= `https://<hostname>`) / `tlsMode` / `tlsCertFingerprint`
(SHA-256 of leaf cert) / `isCustom` / `verificationStatus` (`pending` /
`verified` / `failed`) を持つ。

### 4.3 Output placeholders

| placeholder                   | 値                |
| ----------------------------- | ----------------- |
| `${bindings.<name>.hostname}` | `config.hostname` |
| `${bindings.<name>.url}`      | `config.url`      |

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

Takos が deploy 操作を行いたいときに、**takosumi kernel API を直接叩かず、 Git
repo に manifest fragment を commit する** ための binding。 takosumi-git が repo
を watch して workflow 実行 → kernel apply。

### 5.1 Request fields

| field             | required | type      | 説明                                                                          |
| ----------------- | -------- | --------- | ----------------------------------------------------------------------------- |
| `type`            | yes      | const     | `"deploy-intent.gitops@v1"`                                                   |
| `required`        | no       | boolean   | default `false`                                                               |
| `branch`          | no       | string    | default `main`                                                                |
| `remoteUrl`       | no       | uri       | 省略時 takosumi-git が自動 provision                                          |
| `tokenRef`        | no       | vault-uri | 省略時 自動発行                                                               |
| `writePathPrefix` | no       | string    | default `deployments/`。app が manifest fragment を書ける repo 内 path prefix |

### 5.2 Provisioned config

`driver: "gitops"` 固定 / `remoteUrl` / `branch` / `writePathPrefix` /
`watcherInstallationId` (watcher が動く installation id) を持つ。secret は
`tokenRef`。

token は `writePathPrefix` 配下にのみ push 可能な scoped Git token。

### 5.3 Output placeholders

| placeholder                          | 値                            |
| ------------------------------------ | ----------------------------- |
| `${bindings.<name>.driver}`          | `"gitops"` 固定               |
| `${bindings.<name>.remote}`          | `config.remoteUrl`            |
| `${bindings.<name>.branch}`          | `config.branch`               |
| `${bindings.<name>.writePathPrefix}` | `config.writePathPrefix`      |
| `${secrets.<name>.token}`            | Vault 解決された scoped token |

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

| field                | required | type    | 説明                                   |
| -------------------- | -------- | ------- | -------------------------------------- |
| `type`               | yes      | const   | `"install-launch-token@v1"`            |
| `required`           | no       | boolean | default `true`                         |
| `consumePath`        | no       | path    | default `/_takosumi/launch`            |
| `maxLifetimeSeconds` | no       | int     | 30..300 (hard cap 5 分), default `300` |

### 6.2 Provisioned config

| field                | 説明                                             |
| -------------------- | ------------------------------------------------ |
| `audience`           | JWS aud claim。通常は `appId` (例: `takos.chat`) |
| `issuer`             | launch token issuer URL                          |
| `publicKey`          | JWKS JSON (または export bundle の PEM pubkey)   |
| `algorithm`          | 現行 Accounts issuer は `RS256`                  |
| `kid`                | key id                                           |
| `consumePath`        | request の `consumePath` を継承                  |
| `maxLifetimeSeconds` | 上限 lifetime                                    |

token 発行側の **private key は本 binding には含めない** (Takosumi Accounts
内部に保持)。secret schema は **空** (本 binding は public key と audience の
みを扱う)。

現行 Takosumi Accounts は `POST /v1/installations` 時にこの binding を
`takosumi-accounts://.../launch-token/<kid>` config ref へ materialize し、
`GET /v1/installations/{id}/launch-token` で `INSTALL_LAUNCH_*` にそのまま
注入できる public config を返す。

### 6.3 Output placeholders

| placeholder                      | 値                     |
| -------------------------------- | ---------------------- |
| `${bindings.<name>.publicKey}`   | JWKS JSON / PEM pubkey |
| `${bindings.<name>.audience}`    | aud 値                 |
| `${bindings.<name>.issuer}`      | issuer URL             |
| `${bindings.<name>.algorithm}`   | `EdDSA` / `RS256`      |
| `${bindings.<name>.kid}`         | key id                 |
| `${bindings.<name>.consumePath}` | consume endpoint path  |

### 6.4 Default env injection

```env
INSTALL_LAUNCH_PUBLIC_KEY = ${bindings.<name>.publicKey}
INSTALL_LAUNCH_AUDIENCE   = ${bindings.<name>.audience}
INSTALL_LAUNCH_ISSUER     = ${bindings.<name>.issuer}
```

### 6.5 例

```yaml
bindings:
  bootstrap:
    type: install-launch-token@v1
    required: true
    consumePath: /_takosumi/launch
    maxLifetimeSeconds: 300
```

## 7. Cross-instance imports are manifest-level

Cross-instance service dependency は current AppBinding catalog には含めません。
外部 takosumi instance の service dependency は `.takosumi/manifest.yml` の
`imports[]` と `serviceResolvers[]` で表現し、resource spec から
`${imports.<alias>.endpoints.<role>.url}` を参照します。

```yaml
imports:
  - alias: account-auth
    service: takosumi.account.auth@v1
    refreshPolicy:
      kind: ttl
      ttl: 300s
serviceResolvers:
  - kind: anchor
    url: https://my-anchor.example.com/v1/services
    publicKey: BASE64_ED25519_PUBLIC_KEY
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/aws-fargate"
    spec:
      image: ghcr.io/example/api@sha256:0123456789abcdef
      port: 8080
      scale: { min: 1, max: 3 }
      env:
        OIDC_ISSUER_URL: ${imports.account-auth.endpoints.oidc-issuer.url}
```

詳細は
[reference/manifest-spec § Cross-instance imports](/reference/manifest-spec#cross-instance-imports)
と
[architecture/cross-instance-service-binding](/architecture/cross-instance-service-binding)
を参照。

## 8. Placeholder 解決順序

installer / account-plane materializer が manifest compile 前に解決する
placeholder の優先順位:

1. `${params.*}` — install API の `params` 引数
2. `${installation.*}` — `id` / `accountId` / `spaceId` / `baseUrl`
3. `${artifacts.*}` — workflow run の output (image digest 等)
4. `${bindings.<name>.*}` — 本 catalog の Output placeholders
5. `${secrets.<name>.*}` — Vault 解決
6. `${env.*}` — operator-owned manifest generation input。kernel resolver
   ではない
7. kernel-bound references — `${ref:...}` / `${secret-ref:...}` /
   `${imports...}` は kernel が apply 時に解決

kernel-bound references は compiled manifest にそのまま残るが、それ以外 (1〜5 と
legacy `${refs.*}`) は **compiled manifest に残らない** invariant。 current
`takosumi-git` は unresolved installer-only placeholder を解決したふりで
渡さず、compile error にする。`${env.*}` は kernel resolver ではないため、
使う場合は operator-owned manifest generation で concrete value にする。

### 8.1 名前衝突の禁止

同一 `.takosumi/app.yml` 内で同じ binding name (`bindings.<name>`) を 2 回
宣言することは禁止。schema validation で検出する。

### 8.2 default env injection の override

各 binding の Default env injection は、manifest 中の compute resource が `env:`
を **明示しなかった** key にのみ適用される。明示時はそのまま採用 (compile 時
placeholder は通常通り解決)。Accounts provider materializer が返す one-shot
`binding_env` は takosumi-git が kernel deploy request を送る直前に適用し、
AppInstallation ledger には raw secret value ではなく `configRef` / `secretRefs`
だけを保存する。

### 8.3 required vs optional

`request.required: false` の binding が provision されなかった場合、 authoring
manifest 中の `${bindings.<name>.*}` / `${secrets.<name>.*}` / default env
injection はすべて **空文字列に解決されず compile error** とする。

required false binding を runtime で扱いたい app は、`.takosumi/app.yml` 側で
env を分岐定義するか、別 manifest variant を持つ。

## 9. 参照される manifest snippet

[`.takosumi/app.yml`](/reference/app-yml-spec) の `bindings:` 節と reserved
placeholder vocabulary は次のように対応する。current `takosumi-git`
に未解決のまま渡すと compile error になるため、下の manifest snippet は
account-plane materializer の入力 contract を示す。

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
# .takosumi/manifest.yml (authoring, takosumi-git が compile)
apiVersion: "1.0"
kind: Manifest
resources:
  - shape: web-service@v1
    name: api
    provider: "@takos/kubernetes-deployment"
    spec:
      image: "${artifacts.api.image}"
      env:
        AUTH_DRIVER: "oidc"
        OIDC_ISSUER_URL: "${bindings.auth.issuerUrl}"
        OIDC_CLIENT_ID: "${bindings.auth.clientId}"
        OIDC_CLIENT_SECRET: "${secrets.auth.clientSecret}"
        OIDC_REDIRECT_URI: "${bindings.auth.redirectUri}"
        DATABASE_URL: "${bindings.db.url}"
        BLOB_ENDPOINT: "${bindings.blob.endpoint}"
        BLOB_BUCKET: "${bindings.blob.bucket}"
        BLOB_ACCESS_KEY: "${bindings.blob.accessKey}"
        BLOB_SECRET_KEY: "${secrets.blob.secretKey}"
        BASE_URL: "${bindings.domain.url}"
        TAKOS_INSTALLATION_ID: "${installation.id}"
        INSTALL_LAUNCH_PUBLIC_KEY: "${bindings.bootstrap.publicKey}"
        INSTALL_LAUNCH_AUDIENCE: "${bindings.bootstrap.audience}"
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
- [OIDC Consumer](/apps/oidc-consumer) — Takos 側で OIDC binding を消費する 実装
- [Glossary](/reference/glossary) — Installable App Model 用語の正本
