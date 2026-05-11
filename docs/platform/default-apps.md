# Bundled App Distribution

Takos の bundled app distribution は、managed install / self-host bootstrap
で提示する app 候補の初期セットです。canonical install は operator の Takosumi
Accounts AppInstallation API と `takosumi-git` installer pipeline を通り、
compiled manifest は Takosumi kernel の `POST /v1/deployments` に投下されます。

`takos-apps/` 配下と `yurucommu/` の product/reference repos は bundled app
の参照元です。Takos app repo 側の preinstall worker は、設定された
`takosumi-git serve` `/v1/install/apply` に Git URL install を委譲し、Takosumi
Accounts の AppInstallation ledger を正本にします。install apply endpoint
が未設定の場合だけ、repository source を使う旧 preinstall queue が self-host
compatibility fallback として動きます。どちらの path も
`TAKOS_DEFAULT_APPS_PREINSTALL=true` の明示 opt-in がない限り動きません。

> **重要**: Agent / Chat / Git / Storage / Store は Takos product の core
> service / app-layer feature であり、bundled app distribution には含まれない。
> これらは takosumi kernel 機能ではない。一方、下記の 5 つは bundled preinstall
> 候補だが、primitive や group は特権化されない。

## 一覧

bundled app distribution の初期セットは以下の 5 つ（Agent / Chat / Git / Storage
/ Store は Takos product core feature のため含まれない）:

| group                                      | 既定 ref     | 役割                                  | app metadata / bindings                                         |
| ------------------------------------------ | ------------ | ------------------------------------- | --------------------------------------------------------------- |
| [takos-docs](/platform/takos-docs)         | `v0.1.2` tag | リッチテキストエディタ                | launcher / MCP endpoint / file handler / storage grant          |
| [takos-excel](/platform/takos-excel)       | `v0.1.2` tag | スプレッドシート                      | launcher / MCP endpoint / file handler / storage grant          |
| [takos-slide](/platform/takos-slide)       | `v0.1.2` tag | プレゼンテーション                    | launcher / MCP endpoint / file handler / storage grant          |
| [takos-computer](/platform/takos-computer) | `v2.1.2` tag | sandbox computer / browser automation | launcher / MCP endpoint / sandbox web-service / Takos API grant |
| [yurucommu](/platform/yurucommu)           | `v1.2.4` tag | ActivityPub / community social        | launcher / `identity.oidc@v1` / DB / object-store / queue       |

bundled app の launcher / MCP / file handler entry は kernel manifest の
`publications[]` ではなく、Takos app catalog / runtime registry の metadata
です。 workload 自体は `.takosumi/manifest.yml` の Shape resources で deploy
します。

office 系 bundled apps は **OIDC consumer** です。`identity.oidc@v1` AppBinding
を `operator.identity.oidc` namespace export で解決される Takosumi Accounts から
受け取り、ユーザー認証を OIDC issuer に委譲します。bundled app 自身は OAuth
provider ではありません ([OIDC Consumer](/apps/oidc-consumer) /
[binding-catalog](https://github.com/tako0614/takos-ecosystem/blob/master/docs/reference/binding-catalog.md#_1-identity-oidc-v1)
参照)。

office 系 bundled apps は root UI、`/mcp`、`/files/:id` を同じ worker / web
service resource で expose し、launcher / MCP / file handler metadata を
registry に登録します。MCP bearer token は installer secret / provider secret
ref として `MCP_AUTH_TOKEN` に materialize します。app 実装は token 未設定時に
fail closed し、local/dev 等で意図的に認証なしにする場合だけ
`MCP_ALLOW_UNAUTHENTICATED=true` を設定します。

takos-computer も OIDC consumer で、`/gui/api/auth/callback` で OIDC callback を
受けます。公開 `/mcp` 用の `PUBLISHED_MCP_AUTH_TOKEN` は MCP integration の
machine credential であり、end-user 認証とは別 layer です。sandbox runtime は
`web-service@v1` / provider-specific implementation で materialize します。

yurucommu は `identity.oidc@v1` AppBinding で sign-in し、自前の database /
object-store / queue / secret resources を持つため、office 系 bundled apps より
resource footprint が大きい。

## Office file contracts

office 系 bundled apps は Storage の file handler registry に登録され、Storage
UI から該当ファイルを開くと各 app の `/files/:id` route に遷移します。handler
metadata は app catalog / runtime registry の surface で、kernel manifest の
`publications[]` ではありません。

| app         | route        | extension     | MIME type                          |
| ----------- | ------------ | ------------- | ---------------------------------- |
| takos-docs  | `/files/:id` | `.takosdoc`   | `application/vnd.takos.docs+json`  |
| takos-excel | `/files/:id` | `.takossheet` | `application/vnd.takos.excel+json` |
| takos-slide | `/files/:id` | `.takosslide` | `application/vnd.takos.slide+json` |

office 系 app の API / UI / MCP は request ごとに `space_id` または `spaceId`
query parameter を読む。指定がある場合はそれを Storage space として使い、指定が
ない場合は optional env `TAKOS_SPACE_ID` を fallback として使う。どちらもない
request は `space_id is required` として失敗する。Takos managed deploy では
Storage への endpoint / token は app-layer grant から `TAKOS_STORAGE_API_URL` /
`TAKOS_STORAGE_ACCESS_TOKEN` に materialize される。

## 動作原理

canonical path では、各 entry は InstallableApp として解決されます。

- Takosumi Accounts が AppInstallation owner / binding / consent / billing
  attribution を持つ
- `takosumi-git install apply` が source ref を commit / manifest digest に pin
  し、結果を Accounts API に報告する
- `takosumi-git` が `.takosumi/manifest.yml` と workflow artifact を解決し、
  Takosumi kernel へ explicit manifest を投下する
- preinstall された app は AppInstallation / Store / launcher surfaces
  で確認し、Takos app-local group inventory は互換表示に限る
- default set に含まれても primitive や group 自体は特権化されない

Takos app repo の preinstall worker は compatibility surface です。
`TAKOS_DEFAULT_APPS_PREINSTALL=true` の場合だけ、新規 space 作成時に
`default_app_preinstall_jobs` を作成します。

- `TAKOS_DEFAULT_APP_INSTALL_APPLY_URL` /
  `TAKOS_DEFAULT_APP_INSTALL_APPLY_TOKEN` / `TAKOS_DEFAULT_APP_INSTALL_SUBJECT`
  が設定されている場合、worker は各 bundled app entry を `takosumi-git serve`
  `/v1/install/apply` に POST し、Git URL checkout / preview / Accounts
  AppInstallation 作成 / kernel deploy を takosumi-git 側に委譲します。成功した
  job は Takos 側では `completed` とし、以降の lifecycle / audit は
  AppInstallation ledger を見ます。
- install apply endpoint が未設定の場合だけ、legacy fallback として現在の
  distribution を repository URL / ref / refType の `group_deployment_snapshot`
  queue job に渡します。この path は `.takosumi/` workflow の正本ではなく、
  source/workflow/git deploy の current ownership は `takosumi-git`
  側にあります。`DEPLOY_QUEUE` binding がない環境では legacy job は
  `pending_queue` になり、queue が後から用意される前提で保留されます。
- install apply endpoint の設定が一部だけ存在する場合は silent fallback せず
  `blocked_by_config` になります。

bundled app は通常の app installation / group として扱われるため、次の責務は app
側で実装します。

- 自前の sql/object-store で data を管理する
- 自前の HTTP API を expose する
- AppBinding / app-layer grant を使って API access token を得る
- env injection で他 group の URL を得る

一方で bundled app は kernel 内部 API を直接呼び出す特権を持ちません。Takos API
への access は、他の app と同じく app-layer grant と injected secret
を経由します。

bundled app の UI / API は通常 group subdomain で serve されます。Takos browser
session cookie は host-only の `__Host-tp_session` であり、`Domain` attribute を
持たないため、Takos host と group subdomain の間では共有されません。bundled app
が Takos API を呼ぶ場合は cookie 共有に依存せず、injected Takos API token を
`Authorization: Bearer ...` として送ります。

launcher / MCP / file handler metadata を sidebar + iframe 統合や agent catalog
に 使うかどうかは Takos app layer の解釈です。kernel は Shape manifest の apply
に 集中し、app metadata registry を所有しません。

## Operator overrides

bundled app distribution は operator configuration
で差し替えられます。AppInstallation path では takosumi-git install apply request
の Git URL / ref 入力になり、legacy fallback では space bootstrap 時に作る旧
`group_deployment_snapshot` queue job の入力になります。どちらも bundled app
を特権化しません。backend / env の指定は legacy fallback 用の operator-only
field で、`.takosumi/manifest.yml` の public manifest に provider / backend
を書く仕組みではありません。

Product distribution profile は `defaultApps.entries` に既定の repository ref を
持ち、`defaultApps.environmentOverrides.<local|staging|production>.preinstall`
で環境ごとの preinstall 対象を選べます。Takos-operated deploy では
`takos-private` の deploy wrapper が profile と環境名から
`TAKOS_DEFAULT_APP_DISTRIBUTION_JSON` を生成できますが、Takos app 側の
preinstall 実行は `TAKOS_DEFAULT_APPS_PREINSTALL=true` を明示した場合だけです。

| env                                          | 説明                                                                                                                                                                                                                    |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TAKOS_DEFAULT_APPS_PREINSTALL`              | default app preinstall worker の opt-in。既定は disabled。`true` / `1` / `yes` / `on` の場合だけ bundled app install job を作る                                                                                         |
| `TAKOS_DEFAULT_APP_INSTALL_APPLY_URL`        | AppInstallation path で使う `takosumi-git serve` `/v1/install/apply` endpoint。未設定なら legacy deploy queue fallback を使う                                                                                           |
| `TAKOS_DEFAULT_APP_INSTALL_APPLY_TOKEN`      | install apply endpoint に送る bearer token。`TAKOS_DEFAULT_APP_INSTALL_APPLY_URL` を使う場合は必須                                                                                                                      |
| `TAKOS_DEFAULT_APP_INSTALL_SUBJECT`          | Accounts ledger の `createdBySubject` として takosumi-git に渡す operator subject。`TAKOS_DEFAULT_APP_INSTALL_APPLY_URL` を使う場合は必須                                                                               |
| `TAKOS_DEFAULT_APP_INSTALL_ACCOUNT_ID`       | install apply request の `accountId` override。未設定時は job の `createdByAccountId`、それも無い場合は `spaceId` を使う                                                                                                |
| `TAKOS_DEFAULT_APP_INSTALL_MODE`             | install apply request の optional runtime mode (`shared-cell` など)                                                                                                                                                     |
| `TAKOS_DEFAULT_APP_INSTALL_RUNTIME_BASE_URL` | install apply request の optional runtime base URL                                                                                                                                                                      |
| `TAKOS_DEFAULT_APP_DISTRIBUTION_JSON`        | legacy distribution 全体を JSON array で置き換える                                                                                                                                                                      |
| `TAKOS_DEFAULT_APP_REPOSITORIES_JSON`        | legacy repository list を JSON array で渡す。`repositoryUrl` または `url` を受け付け、`name` 省略時は repo URL から推定する                                                                                             |
| `TAKOS_DEFAULT_APP_REF`                      | fallback distribution 全体の ref override。省略時、builtin fallback は各 entry の pinned tag、operator JSON entry は compatibility default として `main`                                                                |
| `TAKOS_DEFAULT_APP_REF_TYPE`                 | `branch` / `tag` / `commit`。未知値は validation error になる                                                                                                                                                           |
| `TAKOS_DEFAULT_APP_BACKEND`                  | app/deploy queue compatibility job に渡す operator-only backend label。`cloudflare` / `local` / `aws` / `gcp` / `k8s`。kernel の provider/plugin 選択は `TAKOS_KERNEL_PLUGIN_CONFIG` と external plugin bundle 側で行う |
| `TAKOS_DEFAULT_APP_ENV`                      | deploy queue job に渡す environment 名                                                                                                                                                                                  |
| `TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL`      | fallback の `takos-docs` repository URL を置き換える                                                                                                                                                                    |
| `TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL`     | fallback の `takos-excel` repository URL を置き換える                                                                                                                                                                   |
| `TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL`     | fallback の `takos-slide` repository URL を置き換える                                                                                                                                                                   |
| `TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL`  | fallback の `takos-computer` repository URL を置き換える                                                                                                                                                                |
| `TAKOS_DEFAULT_YURUCOMMU_APP_REPOSITORY_URL` | fallback の `yurucommu` repository URL を置き換える                                                                                                                                                                     |

`TAKOS_DEFAULT_APP_DISTRIBUTION_JSON` の entry は以下を受け付けます。

```json
[
  {
    "name": "takos-docs",
    "title": "Docs",
    "repositoryUrl": "https://github.com/example/takos-docs.git",
    "ref": "v0.1.2",
    "refType": "tag",
    "preinstall": true,
    "backendName": "cloudflare",
    "envName": "production"
  }
]
```

`name`, `title`, `repositoryUrl`, `ref`, `refType`, `preinstall`, `backendName`,
`envName` 以外の field は current contract では使いません。`repositoryUrl` は
HTTPS URL で、credential を含めません。

`TAKOS_DEFAULT_APP_REPOSITORIES_JSON` は簡易形式として以下を受け付けます。

```json
[
  {
    "name": "takos-docs",
    "title": "Docs",
    "url": "https://github.com/example/takos-docs.git"
  },
  "https://github.com/example/takos-whiteboard.git"
]
```

DB 管理する場合は `default_app_distribution_config` の `id='default'` row
で「operator が DB distribution を設定済みか」を表し、
`default_app_distribution_entries` に repository list を保存する。
`default_app_preinstall_jobs` は space ごとの preinstall retry queue であり、
distribution の管理元ではありません。preinstall job には
`distribution_json`、`expected_group_ids_json`、`deployment_queued_at`
を保存し、deploy queue 投入時点の distribution cache、完了待ち group、deploy
queue watchdog の基準時刻を持たせます。

解決順は `TAKOS_DEFAULT_APP_DISTRIBUTION_JSON` →
`TAKOS_DEFAULT_APP_REPOSITORIES_JSON` → DB → fallback distribution です。env
distribution がある場合はそれが最優先で、repository list env
はその次に優先され、どちらも設定されているときは DB を読まない。env override
が設定されている状態で DB distribution を保存しても runtime には
反映されないため、internal save API は `409 CONFLICT` を返します。DB-managed
distribution を使う場合は、両方の JSON env を unset してから保存します。

DB distribution が設定済みの場合は「空」や「すべて disabled」のときに fallback
へ落とさず、その結果をそのまま使う。一方、DB read 自体が失敗した場合や table
がまだない場合は fail-open で static fallback distribution を使う。DB row や env
entry の validation error は fallback せず、preinstall job を
`blocked_by_config` として backoff retry に回す。operator が DB distribution
を保存した場合は、`blocked_by_config` の job を即時 retry 対象へ戻す。

`TAKOS_DEFAULT_APPS_PREINSTALL` は explicit opt-in です。未設定または `false`
の場合、env entry に `preinstall: true` が入っていても preinstall worker は
止まる。既存の queued job は削除せず `paused_by_operator` にして backoff
するため、operator が `true` に戻すと maintenance scan で再開できます。

DB から解決した distribution は DB binding ごとの isolate-local L1 cache
に短時間保存される。DB 保存処理で repository list を保存した場合は cache
も即時に warm されるため、直後の space bootstrap は追加の DB read なしで同じ
list を利用できる。`saveDefaultAppDistributionEntries` は DB を触る前に入力を
validate し、duplicate name / duplicate repository URL もここで reject する。
repository URL の duplicate 判定は scheme / host と `.git` suffix / trailing
slash を正規化するが、path の大文字小文字は保持する。

preinstall job は install apply path では `queued` → `in_progress` → `completed`
になり、Takos 側で group deployment completion を監視しません。install apply
が失敗した場合は retry し、設定不備は `blocked_by_config` にします。

legacy fallback job は `queued` → `in_progress` → `deployment_queued`
を経て、deploy queue 側で expected group の deployment record
適用が確認されたときに `completed` になる。deploy が失敗または DLQ
に入った場合は `failed` になる。 `blocked_by_config` と `paused_by_operator` は
backoff 後に再 scan される。 `in_progress` の lease が古くなった job は
maintenance scan で再 claim される。 `queued` / `blocked_by_config` /
`paused_by_operator` / stale `in_progress` の job は処理時に現在の distribution
を解決し直す。 `deployment_queued` のまま watchdog 時間を超えた job も再 scan
され、expected group が未適用なら保存済み `distribution_json` から queue job
を再送する。 deploy queue 側の完了/失敗通知は `expected_group_ids_json` と
`distribution_json` に一致する message だけ preinstall job に反映するため、古い
queue message や operator 変更前の message で新しい job を完了/失敗にしない。
同名の既存 group が distribution entry と異なる source を指す場合は silent skip
せず conflict として failed にする。

## Admin API boundary

bundled app distribution は instance-wide な operator configuration であり、
通常の user / space-scoped admin 権限では変更できません。公開 API には platform
operator を識別する共通 middleware / scope がないため、DB distribution
を保存する user-facing HTTP API は公開しません。

既存の認可 surface は以下の境界で分かれます。

- `/api/*` の通常 route は `requireAuth` で user を識別する
- `owner` / `admin` は space membership の role であり、platform operator
  権限ではない
- OAuth / PAT scope は public resource access 用であり、operator-only
  configuration を表さない
- service / internal token は runtime proxy 等の用途に閉じており、operator 管理
  API 用の権限ではない

現在の public API に bundled app distribution を変更する route はありません。
operator は env または DB seed / migration / internal automation で
`default_app_distribution_config` と `default_app_distribution_entries`
を管理します。

self-host / internal automation 向けには、loopback または cluster-internal
hostname からだけ使える `PUT /internal/default-app-distribution`
があります。body は JSON array、または `{ "entries": [...] }` /
`{ "repositories": [...] }` です。この route は public admin domain
からは使えません。

同じ boundary で `DELETE /internal/default-app-distribution` も使えます。これは
DB-managed distribution を clear し、`default_app_distribution_config` の
`configured=false` を保存するため、runtime は fallback distribution へ戻ります。
env JSON override が設定されている場合は DELETE も `409 CONFLICT` で拒否します。

reconcile 状態は `GET /api/internal/v1/default-apps/status` で取得できます。
response には解決中の distribution source (`env_distribution` /
`env_repositories` / `db` / `fallback` / `disabled`)、entry 数、preinstall
対象数、`default_app_preinstall_jobs` の status 別件数、最新更新時刻、直近の job
error が含まれます。この endpoint も loopback / cluster-internal hostname
向けで、public user API ではありません。

`PUT /internal/default-app-distribution` は operator 入力の validation error を
`400 BAD REQUEST` として返します。DB write / transaction などの platform failure
は validation error として扱わず、server error として失敗させます。
`TAKOS_DEFAULT_APP_DISTRIBUTION_JSON` または
`TAKOS_DEFAULT_APP_REPOSITORIES_JSON` が設定されている場合は env が DB より優先
されるため、DB save は `409 CONFLICT` で拒否されます。

`localhost` / `127.0.0.1` などの loopback では local dev 用に secret
なしで利用できますが、cluster-internal hostname (`control-web`) から呼ぶ場合は
`TAKOS_INTERNAL_API_SECRET` を設定し、request に
`X-Takos-Internal-Secret: <TAKOS_INTERNAL_API_SECRET>` を付ける必要があります。
secret 未設定、または header 不一致の場合は拒否されます。

同じ internal API boundary は `POST /internal/scheduled?cron={form}`
にも適用されます。この HTTP endpoint は Cloudflare Workers の `scheduled()`
handler とは別の self-host / dev 向け入口であり、Cloudflare scheduled event
自体は header secret を使いません。

## URL 体系

Takos app/API gateway は `{APP_DOMAIN}` で serve し、各 bundled app group は
Takosumi route projection で独自の hostname を持つ。

```text
Takos app/API gateway ({APP_DOMAIN}):
  /                      → Takos chat / agent / dashboard
  /api/*                 → Takos public API
  /auth/*                → OIDC consumer session routes
  /settings              → Takos settings

Groups (routing layer で hostname 割り当て):
  group は最大 3 つの hostname を持てる:

  1. auto:          {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}（常に存在、衝突しない）
  2. custom slug:   {custom-slug}.{TENANT_BASE_DOMAIN}（optional、globally unique）
  3. custom domain: 任意のドメイン（optional、DNS 検証）

  例 (space: team-a):
    auto:          team-a-my-docs.app.example.com      → docs group
    auto:          team-a-my-excel.app.example.com     → excel group
    auto:          team-a-my-slide.app.example.com     → slide group
    custom slug:   my-docs.app.example.com             → optional docs group slug
    custom domain: docs.mycompany.com                  → optional docs group domain
```

Takos app/API gateway と bundled app group はドメインが完全に分離される。

## 認証フロー

### ユーザー → Group

1. ユーザーが Takosumi Accounts OIDC issuer で sign-in する
2. bundled app は `identity.oidc@v1` AppBinding で発行された client credential
   を 使い、app-local session cookie を自分の host に発行する
3. cookie が共有されない構成（custom domain 等）でも、各 app は同じ OIDC issuer
   と callback flow で認証を検証する

### Group 間 (サーバー)

group が他 group のサーバー API や Takos API を呼ぶ場合は namespace export、 app
metadata registry、または app-layer grant が供給する endpoint / credential
を使う。

1. 提供側 app が service export / registry metadata を公開する、または呼び出し側
   app が AppGrant を要求する
2. 呼び出し側 workload が env / secret ref として endpoint / credential
   を受け取る
3. 呼び出し元 group はその credential を `Authorization` header 等に載せる
4. 受信側は通常の PAT / OIDC-derived token / integration-managed credential
   として 検証する
