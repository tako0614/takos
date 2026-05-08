# AppInstallation 台帳

**AppInstallation 台帳**は Installable App Model における **所有権の primitive**
です。OAuth だけでは「この installation の owner は誰か / 誰に請求するか / 誰が
revoke できるか / 何を export できるか」は決まりません。これらは すべて
AppInstallation 台帳 (AppInstallation / AppBinding / AppGrant / RuntimeBinding /
InstallationEvent) に anchor され、Takosumi Accounts が 正本として保持します。

ここで定義する 5 entity が ownership / source pin / runtime mode / capability /
audit のすべての semantics を担います。export / materialize / upgrade / rollback
/ revoke / suspend / uninstall は、すべてこの台帳の record 操作と
して表現されます。

## このページで依存してよい範囲

- AppInstallation / AppBinding / AppGrant / RuntimeBinding / InstallationEvent
  の table 設計と status 遷移
- AppInstallation が「Takosumi Account → Space → AppInstallation」階層の末端
  にいること
- ユーザーに見せる Settings 画面の構造
- 各 entity が新 ledger で何を anchor しているか

## このページで依存してはいけない範囲

- Takosumi Accounts の OIDC endpoint / pairwise subject 仕様
  ([Takosumi Accounts](./takosumi-accounts.md) を参照)
- shared-cell / dedicated / self-hosted の物理配置
  ([Runtime Modes](./runtime-modes.md) を参照)
- AppBinding kind ごとの env injection rules
  ([Binding Catalog](/reference/binding-catalog) を参照)
- REST API での AppInstallation 操作 ([Install API](/reference/install-api)
  を参照)
- Space (member / role / capability) の詳細 ([Spaces](/platform/spaces) を参照)

## ownership chain

所有権は次の階層で表現されます。各段階は 1 つ前の record の id を foreign key
で持ち、AppInstallation から逆引きすると owner / billing / source / runtime
までを 1 本のチェーンで追えます。

```txt
TakosumiAccount (acct_123)
   │  legalOwnerId / billingAccountId
   ▼
Space (space_personal | space_team_acme | ...)
   │  accountId / kind: personal | team | org
   ▼
AppInstallation (inst_abc, appId: takos.chat)
   │  source pin (git URL + ref + commit + manifest digest)
   │  runtime mode (shared-cell | dedicated | self-hosted)
   │  RuntimeBinding (cell pointer など)
   ├─▶ AppBinding[]   (identity.oidc / database.postgres / ...)
   ├─▶ AppGrant[]     (capability + scope, revokable)
   └─▶ InstallationEvent[]   (append-only audit)
```

詳細は [Installable App Model](./installable-app-model.md) の責務分離節と、
Space / membership 側は [Spaces](/platform/spaces) を参照。

## 5 entity の table 設計

TypeScript で表現した正本 schema です (出典: `new.md` §7)。実装上は Takosumi
Accounts の DB に置かれます。

```ts
type TakosumiAccount = {
  id: string;
  legalOwnerId: string;
  billingAccountId: string;
  createdAt: string;
};

type Space = {
  id: string;
  accountId: string;
  kind: "personal" | "team" | "org";
  name: string;
};

type AppInstallation = {
  id: string;
  accountId: string;
  spaceId: string;

  appId: "takos.chat";
  sourceGitUrl: string;
  sourceRef: string;
  sourceCommit: string;

  appManifestDigest: string;
  compiledManifestDigest: string;

  mode: "shared-cell" | "dedicated" | "self-hosted";
  runtimeBindingId: string;

  status:
    | "installing"
    | "ready"
    | "failed"
    | "suspended"
    | "exported";

  createdBySubject: string;
  createdAt: string;
  updatedAt: string;
};

// 外部公開 status (REST / UI / event payload で使う canonical 5 値) は上記の
// `status` field のみ。transitional substate (in-flight phase の内部表現) は
// 下記 §"Transitional substates" を参照。

type AppBinding = {
  id: string;
  installationId: string;
  kind:
    | "identity.oidc@v1"
    | "database.postgres@v1"
    | "object-store.s3-compatible@v1"
    | "domain.http@v1"
    | "deploy-intent.gitops@v1"
    | "install-launch-token@v1";

  configRef: string;
  secretRefs: string[];
};

type AppGrant = {
  id: string;
  installationId: string;
  capability: string;
  scope: Record<string, unknown>;
  createdAt: string;
  revokedAt?: string;
};
```

### TakosumiAccount

契約 / 請求 / 法的 owner の anchor record。1 user (or 1 organization) に対して 1
つだけ作られ、複数の Space を抱えます。billing は `billingAccountId` 経由で
[Takosumi Cloud billing](/reference/glossary#takosumi-cloud-billing)
に紐づきます。

### Space

AppInstallation の親 scope。`personal` / `team` / `org` の kind を持ち、 member
/ role の管理は Space 単位で行います ([Spaces](/platform/spaces))。

「Takosumi Account が space の親、space が AppInstallation の親」 — この階層を
書き換えてはいけません。**「Takos が tenant の親」だった legacy 表現は
Installable App Model では使いません**。

### AppInstallation

ownership primitive の中核 record。1 つの installation = 1 つの「Takos が
install されたインスタンス」です。次の不変条件をすべての操作で守ります。

- `sourceGitUrl` + `sourceRef` + `sourceCommit` は **install 後に永続記録**
  される。`ref=main` / `ref=latest` のような mutable ref は使わない (tag か
  commit SHA に pin)
- `appManifestDigest` (= `.takosumi/app.yml` の sha256) と
  `compiledManifestDigest` (= kernel に渡された compiled manifest の sha256)
  を保存する。これにより install したものを後から完全に説明可能
- `mode` の変更 (例: shared-cell → dedicated) は `runtimeBindingId` の差し替え
  として表現する。AppInstallation id は同じまま
- `accountId` / `spaceId` は移動可能だが、必ず InstallationEvent に記録する

### AppBinding

AppInstallation に紐づく具体的な binding 1 record。kind は
[Binding Catalog](/reference/binding-catalog) の 6 種に限定されます。

- `identity.oidc@v1`: Takosumi Accounts が発行する OIDC client
- `database.postgres@v1`: managed Postgres (shared-cell では schema namespace)
- `object-store.s3-compatible@v1`: S3 互換 blob (shared-cell では prefix)
- `domain.http@v1`: hostname + TLS
- `deploy-intent.gitops@v1`: Takos からの deploy intent (Git remote)
- `install-launch-token@v1`: launch token signing key (public key を Takos
  に注入)

Cross-instance service dependency は AppBinding ではありません。Accounts /
billing などの external service は compiled manifest の `imports[]` /
`serviceResolvers[]` と `${imports...}` reference で解決します。

`configRef` / `secretRefs` は実値を直接持たず、Takosumi Accounts の secret store
/ config store を参照します。kernel に渡る最終 manifest では env として
解決済み値が注入されます (詳細は
[Binding Catalog](/reference/binding-catalog))。

### AppGrant

AppInstallation に対する capability grant の 1 record。**ユーザーが任意の
タイミングで revoke 可能** であることが ownership 強度の鍵です。

代表例:

```txt
app.profile.write       Takos profile を更新する権限
app.memory.write        agent memory 領域への書き込み
deploy.intent.write     deploy-intent.gitops binding を介した deploy 発行
logs.read.own           installation 自身の logs を読む
billing.usage.report    使用量を Takosumi Accounts に報告
```

revoke 経路:

```txt
takosumi grants inst_abc revoke deploy.intent.write
   ↓
AppGrant ledger: revokedAt set
   ↓
takosumi-git watcher が以後の deploy intent を reject
   ↓
Takos UI で「deploy 機能が無効になりました」表示
```

### RuntimeBinding (補助 record)

AppInstallation を物理 runtime に bind する pointer。shared-cell では Cell
identifier (`tokyo-cell-03` 等)、dedicated では deployment id、self-hosted では
operator-owned takosumi instance を指します。AppInstallation の `mode` 変更は
RuntimeBinding の差し替えとして実現されます (詳細は
[Runtime Modes](./runtime-modes.md))。

### InstallationEvent (audit)

AppInstallation lifecycle の append-only audit ledger。代表 event:

```txt
installation.created
workflow-started / workflow-failed / workflow-succeeded
deployed / ready / failed
launched
materialize-requested / materialize-applied
upgrade-applied / rollback-applied
exported / deleted
binding.rotated
grant.granted / grant.revoked
```

InstallationEvent は ecosystem 全体の audit log の subset として 扱われます
(legal / compliance retention は別 layer)。

## status 遷移

`AppInstallation.status` の遷移図です。`installing` で entry 作成、 `ready`
で稼働、failure 系は `failed`、operator が一時停止すると `suspended`、 self-host
へ移送し終わると `exported` になります。

```txt
         takosumi-git pipeline
             │
             ▼
    ┌──── installing ────┐
    │                    │
workflow / apply         workflow / apply
succeeded                failed
    │                    │
    ▼                    ▼
  ready ◀──── upgrade ──── failed
    │                    ▲
    │ suspend            │  (resolved by retry / fix)
    ▼                    │
suspended ───── resume ──┘
    │
    │ export bundle
    ▼
exported
    │
    │ (optional) hard delete after retention
    ▼
 (purged)
```

遷移ルール:

- `installing → ready`: takosumi-git の install pipeline 13 step 完了
  ([Installer Pipeline](./installer-pipeline.md))
- `installing → failed`: workflow sandbox 失敗 / kernel apply 失敗 / binding
  provision 失敗。InstallationEvent に原因を記録
- `ready → failed`: upgrade 適用中の失敗。rollback で `ready` に戻すこともある
- `ready → suspended`: 課金停止 / policy 違反 / ユーザー操作。runtime は停止
  するが ledger は保持
- `ready → exported`: `takosumi export` で bundle を作成し、ownership chain を
  self-host へ持ち出した状態。export 後の installation は read-only
- `suspended → ready`: 再開
- `failed → ready`: 修復後の再 deploy

各遷移は InstallationEvent に append-only 記録されます。

### Transitional substates (in-flight phases)

外部公開 status は上記の **5 値** (`installing` / `ready` / `failed` /
`suspended` / `exported`) に固定です。実装上、`installing` 中や `ready` から
他遷移を駆動する間に存在する短命な in-flight phase は、`status` を昇格させず
**transitional substate** として表現し、InstallationEvent に記録します。 これは
[Install API](/reference/install-api) の `409 state-conflict` 判定 と
[Upgrade / Export](/platform/upgrade-export) の lifecycle 図と一致する 内部
substate です。

| substate               | parent status | 概要                                                         |
| ---------------------- | ------------- | ------------------------------------------------------------ |
| `upgrading`            | `installing`  | 既存 installation に新 ref / manifest を適用中               |
| `rolling-back`         | `installing`  | upgrade 失敗で旧 ref / manifest に巻き戻し中                 |
| `materializing`        | `installing`  | shared-cell → dedicated への runtime 物理化中                |
| `exporting`            | `installing`  | export bundle 生成中 (完了後 `exported`)                     |
| `uninstalling`         | `installing`  | 削除手続き中 (完了後 ledger は 30 日 retention で `deleted`) |
| `upgrade-failed`       | `failed`      | upgrade で apply に失敗し rollback 待ち                      |
| `materialize-failed`   | `failed`      | materialize 中に kernel apply / cutover が失敗               |
| `deleted` (post-purge) | (ledger 退役) | `uninstalling` 完了後の retention 終了状態 (台帳の墓石)      |

外部公開 API (REST status / events / UI) では substate を直接 `status` には
出さず、必ず canonical 5 値のいずれかへ map します。例えば `materializing` 中の
`GET /v1/installations/{id}` は `status: "installing"` を返し、進行は
InstallationEvent (`installation.materialize-requested` 等) と
`/v1/installations/{id}/events` の SSE で観測します。

## ユーザーに見せる Settings 画面

AppInstallation 台帳の存在は、ユーザーが「裏で何が起きているか」を **説明可能**
にすることで価値を持ちます。Settings 画面は次の構造で 表示します (出典: `new.md`
§7 末尾)。

```txt
Infrastructure

App:
  Takos

Owner:
  your Takosumi Account

Source:
  github.com/takos/takos
  ref: v1.2.3
  commit: 7f3c9...

Runtime:
  mode: shared-cell
  region: Tokyo
  runtime binding: tokyo-cell-03

Auth:
  service: takosumi.account.auth@v1   # service identifier
  issuer: <ACCOUNTS_ISSUER_HOST>       # anchor 経由で resolve された endpoint URL
  client: takos.chat / inst_abc

Grants:
  - app.profile.write
  - app.memory.write
  - deploy.intent.write
  - logs.read.own

Manifest:
  app digest: sha256:...
  compiled digest: sha256:...

Actions:
  [Export]
  [Materialize to dedicated]
  [Revoke grants]
  [View logs]
```

各 field の出典:

- `Source`: AppInstallation.sourceGitUrl / sourceRef / sourceCommit
- `Runtime`: AppInstallation.mode + RuntimeBinding
- `Auth`: AppBinding (`identity.oidc@v1`)
- `Grants`: AppGrant (revokedAt = null のもの)
- `Manifest`: AppInstallation.appManifestDigest / compiledManifestDigest
- `Actions`: Install API ([Install API](/reference/install-api)) を呼び出す

説明可能な魔法は、だいたい工学です。

## 既存 docs との接続

- [Spaces](/platform/spaces) — Space の member / role / capability の詳細。
  AppInstallation の親 scope として参照。
- [Runtime Modes](./runtime-modes.md) — RuntimeBinding の差し替えとしての
  materialize 流れ。
- [Binding Catalog](/reference/binding-catalog) — AppBinding の 6 種 kind ごとの
  env injection rules。
- [Install API](/reference/install-api) — AppInstallation の REST 操作。
- [Upgrade / Export](/platform/upgrade-export) — `exported` 状態に至るまでの
  bundle 構造と self-host import 流れ。
- [Glossary: AppInstallation](/reference/glossary#appinstallation) — 用語定義。

## 次に読むページ

- [Installable App Model](./installable-app-model.md) — 全体像と 5 entity
  責務分離
- [Takosumi Accounts](./takosumi-accounts.md) — 台帳の正本を保持する account
  plane
- [Runtime Modes](./runtime-modes.md) — `mode` field の物理的意味と materialize
  semantics
- [Installer Pipeline](./installer-pipeline.md) — `installing → ready` を
  実現する 13 step
- [Install API](/reference/install-api) — 台帳操作の REST API
- [Spaces](/platform/spaces) — Space の親子関係と membership
