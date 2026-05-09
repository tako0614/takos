# `.takosumi/app.yml` Spec (InstallableApp v1)

`.takosumi/app.yml` は **installer-bound manifest** です。Git URL から install
できる app の identity / source / binding / permission / upgrade policy を 1
ファイルで宣言し、takosumi-git (installer) の唯一 の入口として機能します。本
spec は v1 の field 定義と `.takosumi/manifest.yml` (authoring compute manifest;
compile 後に kernel-bound payload になる) との関係を確定します。

## このページで依存してよい範囲 / してはいけない範囲

**依存してよい範囲**:

- top-level field と nested field の存在 / 必須性 / 型 (§2〜§3)
- `apiVersion` / `kind` の固定 literal (§1)
- `bindings.<name>.type` の closed enum 6 種 (§3.5)
- `serviceImports[]` の installer approval metadata (§3.5.1)
- `permissions.requested` の closed enum 20 種 (§3.7)
- `app.yml` が **kernel に渡らない** という不変条件 (§5)
- `app.yml` (installer-bound) と `manifest.yml` (kernel-bound) の関係 (§5)

**依存してはいけない範囲**:

- 各 binding type の詳細 schema (例: `database.postgres@v1` の `plan`) — Binding
  Catalog 章 (Wave 1 Batch 1.4 で本文化) を参照
- 各 grant capability の semantics — Grant catalog (Wave 1 Batch 1.4) を参照
- `.takosumi/manifest.yml` (authoring compute manifest) の placeholder 文法 /
  解決順序 — [Manifest Reference](/reference/manifest-spec) を参照
- AppInstallation REST API の wire shape — Install API 章 (Phase 1.4) を参照
- takosumi-git installer pipeline の 13 step — Installer Pipeline 章
  ([/architecture/installer-pipeline](/architecture/installer-pipeline)) を参照

---

## 1. `apiVersion` / `kind` の固定 literal

```yaml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp
```

- `apiVersion` は必ず `app.takosumi.dev/v1` の string 一致。他値は parser error
  です
- `kind` は必ず `InstallableApp` の string 一致。他値は parser error です
- 両 field は document の root に直接置きます。nested は不可です

minor 互換拡張 (新 optional field の追加) は v1 のまま行います。 field の削除 /
意味変更が必要な場合は `app.takosumi.dev/v2` への bump が 要ります。

---

## 2. top-level field 一覧

| field            | 必須     | 型           | 概要                                            |
| ---------------- | -------- | ------------ | ----------------------------------------------- |
| `apiVersion`     | ✅       | string lit.  | `app.takosumi.dev/v1` (§1)                      |
| `kind`           | ✅       | string lit.  | `InstallableApp` (§1)                           |
| `metadata`       | ✅       | object       | app の identity / publisher / homepage (§3.1)   |
| `source`         | ✅       | object       | git URL + ref (+ optional commit) の宣言 (§3.2) |
| `entry`          | ✅       | object       | authoring manifest path (§3.3)                  |
| `runtime`        | ✅       | object       | サポートする runtime mode (§3.4)                |
| `bindings`       | ✅       | object (map) | 要求する resource binding 群 (§3.5)             |
| `serviceImports` | optional | array        | 外部 service import approval metadata (§3.5.1)  |
| `install`        | ✅       | object       | install 完了判定と launch 経路 (§3.6)           |
| `permissions`    | ✅       | object       | 要求する AppGrant 群 (§3.7)                     |
| `upgrade`        | optional | object       | upgrade 自動 / 手動 policy (§3.8)               |
| `compatibility`  | optional | object       | takosumi-git / kernel の最小要求 version (§3.9) |

### unknown field

**reject** します。Top-level / nested を問わず、本 spec が定義しない field
を含む `app.yml` は parser error です。実験的拡張のための namespace (例: `x-*`)
は **設けません**。

---

## 3. field 詳細

### 3.1 `metadata`

```yaml
metadata:
  id: takos.chat
  name: Takos
  description: Personal AI workspace
  publisher: takos
  homepage: https://takos.jp
  signingKeyFingerprint: SHA256:abcd... # optional
```

| field                            | 必須     | 制約                                                                                              |
| -------------------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `metadata.id`                    | ✅       | reverse-domain-name format `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`、1〜200 char、ecosystem 内一意 |
| `metadata.name`                  | ✅       | 1〜80 char、display name                                                                          |
| `metadata.description`           | ✅       | 1〜500 char、1 文の app 概要                                                                      |
| `metadata.publisher`             | ✅       | `^[a-z0-9]([a-z0-9-]{0,78}[a-z0-9])?$`、1〜80 char、Takosumi Accounts の publisher table 照合     |
| `metadata.homepage`              | ✅       | `https://` URL。Publisher verification の DNS TXT record 解決元                                   |
| `metadata.signingKeyFingerprint` | optional | `SHA256:<base64>` の Ed25519 pubkey fingerprint。なければ `verified: false` 扱い                  |

`metadata.id` の値は AppInstallation table の `appId` 列と一致します
([/architecture/app-installation](/architecture/app-installation))。

### 3.2 `source`

```yaml
source:
  git: https://github.com/takos/takos
  ref: v1.2.3
  commit: 7f3c9abc... # optional but recommended
```

| field           | 必須     | 制約                                                                              |
| --------------- | -------- | --------------------------------------------------------------------------------- |
| `source.git`    | ✅       | `https://` または `git@host:path` 形式の git URL                                  |
| `source.ref`    | ✅       | git tag / commit SHA。**mutable ref は禁止**                                      |
| `source.commit` | optional | full 40-char hex SHA。指定時は installer が `source.ref` の解決結果と一致確認する |

#### mutable ref 禁止規則

- **禁止**: `main`, `master`, `develop`, `latest`, `HEAD`, branch name 一般
- **許可**: semver tag (`v1.2.3`)、release tag、annotated tag、full 40-char
  commit SHA
- 検出方法: takosumi-git が ref を resolve 後、当該 ref が **branch ref
  ではない** こと、かつ **再度 resolve したときに同じ commit を指す** ことを確認
- 違反時: parser stage で reject (`ref looks mutable: ...`)

根拠は `new.md` §4 / §22.1。install したものの中身を後から説明できる
ようにするため、commit と manifest digest が命綱になります。

### 3.3 `entry`

```yaml
entry:
  manifest: .takosumi/manifest.yml
```

| field            | 必須 | 制約                                                                                                                                   |
| ---------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `entry.manifest` | ✅   | repo root からの relative path。default & 推奨は `.takosumi/manifest.yml`。`..` を含まない。symlink 解決後 repo の外を指してはならない |

`entry.manifest` で指された file は takosumi-git が compile する authoring
compute manifest です。kernel に届くのは placeholder / `workflowRef` を除去した
compiled Shape manifest だけです
([Manifest Reference](/reference/manifest-spec))。

### 3.4 `runtime`

```yaml
runtime:
  modes:
    - shared-cell
    - dedicated
    - self-hosted
```

| field           | 必須 | 制約                                                                                     |
| --------------- | ---- | ---------------------------------------------------------------------------------------- |
| `runtime.modes` | ✅   | string array、1〜3 要素。値は `shared-cell` / `dedicated` / `self-hosted` のみ。重複禁止 |

- `shared-cell` を含む app のみが Use Takos path で install 可能です
- `self-hosted` を含まない app は Export bundle 経由でも別 takosumi に restore
  できません

詳細は [Runtime Modes](/architecture/runtime-modes) を参照してください。

### 3.5 `bindings`

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback

  database:
    type: database.postgres@v1
    required: true
    plan: small

  blob:
    type: object-store.s3-compatible@v1
    required: true
    plan: standard

  deploy:
    type: deploy-intent.gitops@v1
    required: false

  bootstrap:
    type: install-launch-token@v1
    required: true
```

`bindings` は **map**。key は app 内で binding を参照する logical name (例:
`auth`)、value は binding 宣言 object です。

| field                           | 必須        | 制約                                                                |
| ------------------------------- | ----------- | ------------------------------------------------------------------- |
| `bindings.<name>`               | (map entry) | 1〜32 entry。key は `^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$`             |
| `bindings.<name>.type`          | ✅          | 下記 closed enum 6 種のいずれか                                     |
| `bindings.<name>.required`      | conditional | `true` で provision 必須。`false` で provider 不在でも install 続行 |
| `bindings.<name>.redirectPaths` | optional    | `identity.oidc@v1` 専用。`/` 始まり path 配列、1〜10 要素           |
| binding-specific 任意 field     | optional    | 各 binding type の追加 field は Binding Catalog 章で個別定義        |

#### binding type の closed enum (v1)

```
identity.oidc@v1
database.postgres@v1
object-store.s3-compatible@v1
domain.http@v1
deploy-intent.gitops@v1
install-launch-token@v1
```

7 種目以降を追加するときは Binding Catalog の lockstep 拡張を要します (任意 type
の発明は不可)。

Cross-instance service dependency は AppBinding type ではなく、
`.takosumi/manifest.yml` の `imports[]` / `serviceResolvers[]` で宣言します。
ユーザー承認・AppInstallation 台帳に残す endpoint role などの installer metadata
は top-level `serviceImports[]` に分けます。

詳細は
[Manifest spec § Cross-instance imports](/reference/manifest-spec#cross-instance-imports)
を参照してください。

`bindings.<name>` の `<name>` は、account-plane materializer が提供する
`${bindings.<name>.<key>}` / `${secrets.<name>.<key>}` reserved vocabulary と
紐づきます。current takosumi-git に unresolved placeholder を渡すと compile
error です (`new.md` §6)。

### 3.5.1 `serviceImports[]`

`serviceImports[]` は AppBinding ではなく、external service dependency の
installer approval metadata です。0〜32 件の array として宣言し、
`.takosumi/manifest.yml` の `imports[]` と同じ service identifier / alias
を使います。

AppInstallation 台帳に残す `binding` 名と `endpointRoles[]` も宣言します。

```yaml
serviceImports:
  - binding: account-auth
    alias: account-auth
    service: takosumi.account.auth@v1
    endpointRoles:
      - oidc-issuer
      - install-launch
    refreshPolicy:
      kind: ttl
      ttl: 300s
```

| field                            | 必須     | 制約                                                                 |
| -------------------------------- | -------- | -------------------------------------------------------------------- |
| `serviceImports[].binding`       | ✅       | AppInstallation ledger 上の logical name。binding name syntax と同じ |
| `serviceImports[].alias`         | optional | `manifest.yml imports[].alias`。省略時は `binding` と同じ            |
| `serviceImports[].service`       | ✅       | forward 3-level dotted service identifier (`a.b.c@vN`)               |
| `serviceImports[].endpointRoles` | ✅       | `oidc-issuer` など endpoint role identifier の配列、1 以上           |
| `serviceImports[].refreshPolicy` | optional | JSON compatible object。`imports[].refreshPolicy` と同形             |

`serviceImports[]` から `${bindings.*}` / `${secrets.*}` placeholder
は生成しません。

placeholder を必要とする installer-bound resource は `bindings` に宣言します。

takosumi-git は `serviceImports[]` を preview に表示し、同じ alias の
`.takosumi/manifest.yml imports[]` と内容が矛盾しないことを確認します。

manifest に import が無い場合は top-level `imports[]` に merge してから kernel
へ送ります。`serviceResolvers[]` は operator が manifest 側に用意するか、
install / push command の `--service-resolver-url` と
`--service-resolver-public-key` で注入します。

### 3.6 `install`

```yaml
install:
  healthcheckPath: /health
  postInstallLaunchPath: /_takosumi/launch
```

| field                           | 必須 | 制約                                                                                            |
| ------------------------------- | ---- | ----------------------------------------------------------------------------------------------- |
| `install.healthcheckPath`       | ✅   | `/` 始まり path、1〜200 char。HTTP 200 を返したら installation を `ready` に遷移してよい signal |
| `install.postInstallLaunchPath` | ✅   | `/` 始まり path、1〜200 char。Launch token を query で受け、owner session を作る endpoint       |

`postInstallLaunchPath` の URL は Takosumi Accounts が
`https://<installation host>/<postInstallLaunchPath>?token=...` の形に
組み立てます。query は installer / accounts が動的に付与するため、両 path とも
query を含めません。詳細は [Launch Token](/apps/launch-token)
を参照してください。

### 3.7 `permissions`

```yaml
permissions:
  requested:
    - app.profile.write
    - app.memory.write
    - deploy.intent.write
    - logs.read.own
```

| field                   | 必須 | 制約                                                                          |
| ----------------------- | ---- | ----------------------------------------------------------------------------- |
| `permissions.requested` | ✅   | string array、0〜32 要素。各値は下記 closed enum (20 種) のいずれか。重複禁止 |

#### closed enum (v1)

```
app.profile.write
app.memory.write
deploy.intent.write
logs.read.own
billing.usage.report
spaces:read
spaces:write
files:read
files:write
memories:read
memories:write
threads:read
threads:write
runs:read
runs:write
agents:execute
repos:read
repos:write
mcp:invoke
events:subscribe
```

- Install preview で **必ず一覧表示** されます (`new.md` §13, §22.5)
- install 完了時に AppInstallation に対して各 capability の AppGrant が
  発行されます。user は post-install に AppGrant を revoke 可能です
  ([/architecture/app-installation](/architecture/app-installation))
- `openid` / `profile` / `email` などの OIDC scope は
  `identity.oidc@v1.allowedScopes` で宣言し、`permissions.requested` には
  入れません。`files:*` / `threads:*` などの Takos resource scopes は AppGrant
  としてここに宣言します。

### 3.8 `upgrade` (optional)

```yaml
upgrade:
  policy:
    securityPatch: automatic
    minor: ask
    major: ask
```

| field                          | 必須     | 制約                                                |
| ------------------------------ | -------- | --------------------------------------------------- |
| `upgrade.policy.securityPatch` | optional | `automatic` / `ask` / `manual`。default `automatic` |
| `upgrade.policy.minor`         | optional | 同上、default `ask`                                 |
| `upgrade.policy.major`         | optional | 同上、default `ask`                                 |

#### enum 意味

- `automatic`: 新 ref 検出時に preview を出さず、permission diff が
  空の場合に限り apply。permission diff があれば自動で `ask` に degrade
- `ask`: 新 ref 検出時に Install preview の **upgrade variant** を user
  に提示し、approve を待つ
- `manual`: 自動検出を行わず、user が明示的に upgrade を発行したとき のみ動く

### 3.9 `compatibility` (optional)

```yaml
compatibility:
  takosumi-git: ">=0.4.0"
  kernel: ">=1.0.0"
```

| field                        | 必須     | 制約                                                             |
| ---------------------------- | -------- | ---------------------------------------------------------------- |
| `compatibility.takosumi-git` | optional | semver range。takosumi-git installer 自身の version 要求         |
| `compatibility.kernel`       | optional | semver range。takosumi kernel manifest envelope の semver 互換性 |

不一致時は Install preview で warning、install は **block しません**。

---

## 4. 完全な YAML 例

`new.md` §5.1 の Takos 例を canonical fixture として再掲します。

```yaml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp

metadata:
  id: takos.chat
  name: Takos
  description: Personal AI workspace
  publisher: takos
  homepage: https://takos.jp

source:
  git: https://github.com/takos/takos
  ref: v1.2.3

entry:
  manifest: .takosumi/manifest.yml

runtime:
  modes:
    - shared-cell
    - dedicated
    - self-hosted

bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback

  database:
    type: database.postgres@v1
    required: true
    plan: small

  blob:
    type: object-store.s3-compatible@v1
    required: true
    plan: standard

  deploy:
    type: deploy-intent.gitops@v1
    required: false

  bootstrap:
    type: install-launch-token@v1
    required: true

install:
  healthcheckPath: /health
  postInstallLaunchPath: /_takosumi/launch

permissions:
  requested:
    - app.profile.write
    - app.memory.write
    - deploy.intent.write
    - logs.read.own

upgrade:
  policy:
    securityPatch: automatic
    minor: ask
    major: ask
```

### minimal example

最小サイズの positive example。`identity.oidc@v1` のみ要求する hello-world app
です。

```yaml
apiVersion: app.takosumi.dev/v1
kind: InstallableApp

metadata:
  id: example.hello
  name: Hello
  description: Minimal example app
  publisher: example
  homepage: https://example.com

source:
  git: https://github.com/example/hello
  ref: v0.1.0

entry:
  manifest: .takosumi/manifest.yml

runtime:
  modes:
    - shared-cell

bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /auth/oidc/callback

install:
  healthcheckPath: /health
  postInstallLaunchPath: /_takosumi/launch

permissions:
  requested: []
```

---

## 5. `app.yml` (installer-bound) vs `manifest.yml` (kernel-bound)

Installable App Model では Takos repo の `.takosumi/` 配下に **2 種類**
の宣言が並びます。読み手と placeholder の有無で役割を厳密に分けます。

| 観点         | `.takosumi/app.yml`                                           | `.takosumi/manifest.yml`                                                                                 |
| ------------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apiVersion` | `app.takosumi.dev/v1`                                         | `"1.0"` (Shape manifest envelope)                                                                        |
| `kind`       | `InstallableApp`                                              | `Manifest` (required)                                                                                    |
| 読み手       | takosumi-git (installer)                                      | takosumi-git compiler。kernel は compiled payload だけを読む                                             |
| placeholder  | なし (純粋 metadata)                                          | authoring 時のみあり (`${bindings.*}` / `${secrets.*}` / `${ref:...}` / `${imports...}` 等)              |
| compile      | そのまま **kernel に渡らない**                                | installer-only placeholder は未解決なら compile error。`workflowRef` を除去してから kernel に渡る        |
| 保存         | `appManifestDigest` (SHA256)                                  | `compiledManifestDigest` (SHA256)                                                                        |
| 役割         | install UI / binding / service import / permission / metadata | compute resource declaration。kernel-bound references (`${ref:...}` / `${secret-ref:...}` 等) は残り得る |

### kernel に渡らない不変条件

`.takosumi/app.yml` は **takosumi kernel (`POST /v1/deployments`) に
渡りません**。本 contract は **compile-time artifact** であり、 takosumi-git
installer pipeline の Step 3〜11 でのみ参照されます。

kernel が受理するのは `apiVersion: "1.0"` + `kind: Manifest` の Compiled
manifest のみで、`apiVersion: "app.takosumi.dev/v1"` を **知りません**。
これによって kernel は Auth / Account / Billing / Marketplace / Workflow
を一切持たない compute substrate のままを保ちます (`new.md` §2.1)。

### compile pipeline の位置

```
1. Git fetch
2. Ref → commit pin
3. .takosumi/app.yml parse + validate     ← 本 spec
4. .takosumi/manifest.yml parse + validate ← Manifest Reference
5. Install preview 生成
6. user approval 待機
7. workflow を sandbox で実行
8. artifact URI / image digest 解決
9. AppInstallation ledger entry 作成
10. binding provisioning plan / service import merge
11. manifest compile (installer-only placeholder は未解決なら失敗)
12. kernel に POST /v1/deployments        ← Compiled manifest のみ
13. ledger を ready に
```

詳細は [Installer Pipeline](/architecture/installer-pipeline)
を参照してください。

---

## 6. 次に読むページ

- [Manifest Reference](/reference/manifest-spec) — `.takosumi/manifest.yml`
  (kernel-bound) の field 定義 / placeholder 文法
- [OIDC Consumer](/apps/oidc-consumer) — `bindings.auth` (= `identity.oidc@v1`)
  が Takos runtime に渡す env
- [Launch Token](/apps/launch-token) — `bindings.bootstrap` (=
  `install-launch-token@v1`) と `install.postInstallLaunchPath`
- [Installer Pipeline](/architecture/installer-pipeline) — takosumi-git が
  `.takosumi/app.yml` をどう処理するか
- [Install Paths](/apps/install-paths) — Use Takos / Install from Git /
  Self-host の 3 経路
- [AppInstallation 台帳](/architecture/app-installation) — `metadata.id` /
  `appManifestDigest` の永続化先
- [Glossary](/reference/glossary) — InstallableApp / `.takosumi/app.yml` /
  `.takosumi/manifest.yml`
