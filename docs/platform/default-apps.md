# Default App Distribution

Takos の default app distribution は、新規 space に preinstall する app
候補の初期セットです。`takos-apps/` 配下の product/reference repos は default
app の参照元であり、fallback distribution の直接管理元ではありません。実際の
fallback distribution は control code の repository refs と env / operator
overrides から解決されます。

> **重要**: Agent / Chat / Git / Storage / Store は kernel 機能であり、default
> app distribution には含まれない。これらは kernel に常設され uninstall 不可。
> 一方、下記の 4 つは default preinstall 候補だが、primitive や group
> は特権化されない。

## 一覧

default app distribution の初期セットは以下の 4 つ（Agent / Chat / Git / Storage
/ Store は kernel 機能のため含まれない）:

| group                                      | 既定 ref      | 役割                                  | custom publication examples     | capability grants |
| ------------------------------------------ | ------------- | ------------------------------------- | ------------------------------- | ----------------- |
| [takos-docs](/platform/takos-docs)         | `master`      | リッチテキストエディタ                | UiSurface / McpServer           | takos-api         |
| [takos-excel](/platform/takos-excel)       | `master`      | スプレッドシート                      | UiSurface / McpServer           | takos-api         |
| [takos-slide](/platform/takos-slide)       | `master`      | プレゼンテーション                    | UiSurface / McpServer           | takos-api         |
| [takos-computer](/platform/takos-computer) | `default-app` | sandbox computer / browser automation | UiSurface / container workload  | takos-api         |

`takos-api` は route / interface publication ではなく、capability grant です。
`publish[].publisher/type` として表現されます。

office 系 default apps は `UiSurface` と `/mcp` の `McpServer` を publish し、
web compute に `MCP_AUTH_REQUIRED=1` を設定する。takos-computer は `UiSurface`
と Takos API capability grant を publish し、worker + attached container で
sandbox session / MCP proxy routes を提供する。

## 動作原理

各 entry は deploy manifest / repository source から primitive を作成し、必要に
応じて group inventory に所属させる。worker / service / attached container
compute を持ちうる。

- 新規 space の bootstrap で default app preinstall job を
  `default_app_preinstall_jobs` に作成し、space 作成自体は default app deploy
  の成功/失敗に依存しない
- preinstall job の作成時点では repository refs / operator overrides を固定しない。
  job 処理時に現在の distribution を解決し、deploy queue に group snapshot job を
  enqueue する
- deploy queue に投入した preinstall 対象は
  `default_app_preinstall_jobs.distribution_json` に cache として保存する。
  これにより queued のまま残っている job は最新 distribution を拾い、
  `deployment_queued` 後の job は古い queue message と混ざらない
- deploy queue enqueue に失敗した場合は preinstall job が retry
  され、既に作成済みの matching group に対して queue job を再送する
- queue worker が `.takos/app.yml` を解決し、通常の deploy pipeline と同じ経路で
  `ready` または `degraded` へ進める
- preinstall された primitive / group は deploy / group surfaces で確認する。
  current Apps page は Store から追加した apps が並ぶ installed apps inventory
  の入口であり、default distribution 管理そのものではありません
- `DEPLOY_QUEUE` binding がない環境では deploy job は enqueue されず、group の
  `deployJobStatus` は `pending_queue` になる（queue が後から用意される
  前提の保留状態）
- operator は control code 側の repository refs、env の JSON array、または
  `default_app_distribution_config` / `default_app_distribution_entries` DB
  table で default set を変更できる
- `TAKOS_DEFAULT_APPS_PREINSTALL=false` の場合、bootstrap は default app group
  も deploy job も作成しない
- default set に含まれても primitive や group 自体は特権化されない

default app は通常の group として扱われるため、次の責務は app 側で実装します。

- 自前の sql/object-store で data を管理する
- 自前の HTTP API を expose する
- kernel の auth (`/auth/*`) を使って認証する
- env injection で他 group の URL を得る

一方で default app は kernel 内部 API を直接呼び出す特権を持ちません。Takos API
への access は、他の app と同じく capability grant と injected secret を経由します。

kernel は deploy manifest の `publish` から route publication catalog
を保存する。`UiSurface` などの custom type を sidebar + iframe 統合に使うか
どうかは platform 側の解釈です。`McpServer` は agent 側が参照する MCP catalog
entry として扱う。Takos API access は route publication ではなく capability
grant として扱う。各 entry は group に所属しなくても動作する。

## Operator overrides

default app distribution は operator configuration で差し替えられます。これは
space bootstrap 時に作る group scope と deploy queue job の入力であり、default
app を特権化しません。backend / env の指定も operator-only で、`.takos/app.yml`
の public manifest に provider / backend を書く仕組みではありません。

| env                                         | 説明                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `TAKOS_DEFAULT_APPS_PREINSTALL`             | `false` / `0` / `no` / `off` の場合、default app group と deploy job を作らない                                      |
| `TAKOS_DEFAULT_APP_DISTRIBUTION_JSON`       | distribution 全体を JSON array で置き換える                                                                          |
| `TAKOS_DEFAULT_APP_REPOSITORIES_JSON`       | repository list を JSON array で渡す。`repositoryUrl` または `url` を受け付け、`name` 省略時は repo URL から推定する |
| `TAKOS_DEFAULT_APP_REF`                     | fallback distribution 全体の ref override。省略時、builtin fallback は各 entry の既定 ref、JSON entry は `main`      |
| `TAKOS_DEFAULT_APP_REF_TYPE`                | `branch` / `tag` / `commit`。未知値は validation error になる                                                        |
| `TAKOS_DEFAULT_APP_BACKEND`                 | deploy queue job に渡す operator-only backend 名。`cloudflare` / `local` / `aws` / `gcp` / `k8s`                     |
| `TAKOS_DEFAULT_APP_ENV`                     | deploy queue job に渡す environment 名                                                                               |
| `TAKOS_DEFAULT_DOCS_APP_REPOSITORY_URL`     | fallback の `takos-docs` repository URL を置き換える                                                                 |
| `TAKOS_DEFAULT_EXCEL_APP_REPOSITORY_URL`    | fallback の `takos-excel` repository URL を置き換える                                                                |
| `TAKOS_DEFAULT_SLIDE_APP_REPOSITORY_URL`    | fallback の `takos-slide` repository URL を置き換える                                                                |
| `TAKOS_DEFAULT_COMPUTER_APP_REPOSITORY_URL` | fallback の `takos-computer` repository URL を置き換える                                                             |

`TAKOS_DEFAULT_APP_DISTRIBUTION_JSON` の entry は以下を受け付けます。

```json
[
  {
    "name": "takos-docs",
    "title": "Docs",
    "repositoryUrl": "https://github.com/example/takos-docs.git",
    "ref": "main",
    "refType": "branch",
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

`TAKOS_DEFAULT_APPS_PREINSTALL=false` は explicit kill switch であり、env entry
に `preinstall: true` が入っていても preinstall を止める。既存の queued job
は削除せず `paused_by_operator` にして backoff するため、operator が再度 true
に戻すと cron で再開できます。

DB から解決した distribution は DB binding ごとの isolate-local L1 cache
に短時間保存される。DB 保存処理で repository list を保存した場合は cache
も即時に warm されるため、直後の space bootstrap は追加の DB read なしで同じ
list を利用できる。`saveDefaultAppDistributionEntries` は DB を触る前に入力を
validate し、duplicate name / duplicate repository URL もここで reject する。
repository URL の duplicate 判定は scheme / host と `.git` suffix / trailing
slash を正規化するが、path の大文字小文字は保持する。

preinstall job は `queued` → `in_progress` → `deployment_queued` を経て、deploy
queue 側で expected group の snapshot 適用が確認されたときに `completed`
になる。deploy が失敗または DLQ に入った場合は `failed` になる。
`blocked_by_config` と `paused_by_operator` は backoff 後に再 scan される。
`in_progress` の lease が古くなった job は cron で再 claim される。
`queued` / `blocked_by_config` / `paused_by_operator` / stale `in_progress` の job
は処理時に現在の distribution を解決し直す。
`deployment_queued` のまま watchdog 時間を超えた job も再 scan され、expected
group が未適用なら保存済み `distribution_json` から queue job を再送する。
deploy queue 側の完了/失敗通知は `expected_group_ids_json` と
`distribution_json` に一致する message だけ preinstall job に反映するため、古い
queue message や operator 変更前の message で新しい job を完了/失敗にしない。
同名の既存 group が distribution entry と異なる source を指す場合は silent skip
せず conflict として failed にする。

## Admin API boundary

default app distribution は instance-wide な operator configuration であり、
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

現在の public API に default app distribution を変更する route はありません。
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

同じ internal API boundary は `POST /internal/scheduled?cron={form}` にも適用
されます。この HTTP endpoint は Cloudflare Workers の `scheduled()` handler
とは別の self-host / dev 向け入口であり、Cloudflare scheduled event 自体は
header secret を使いません。

## URL 体系

kernel は `{KERNEL_DOMAIN}` で serve し、各 group は独自の hostname を持つ。

```text
Kernel ({KERNEL_DOMAIN}):
  /                      → kernel (agent/chat + dashboard)
  /api/*                 → kernel API
  /auth/*                → kernel auth
  /settings              → kernel settings

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

kernel と group はドメインが完全に分離される。

## 認証フロー

### ユーザー → Group

1. ユーザーが kernel の OAuth でログイン → session cookie が
   `.{TENANT_BASE_DOMAIN}` にセット
2. kernel と group が同じ parent domain (`.{TENANT_BASE_DOMAIN}`)
   を共有している場合、cookie は共有される
3. cookie が共有されない構成（custom domain 等）では、各 group は kernel の auth
   / OAuth endpoint を使って認証を検証する

### Group 間 (サーバー)

group が他 group のサーバー API や kernel API を呼ぶ場合は publication または
Takos capability grant が供給する endpoint / credential を使う。

1. group が route publication または Takos capability grant を宣言する
2. 呼び出し側 compute が `consume` で endpoint / credential を受け取る
3. 呼び出し元 group はその credential を `Authorization` header 等に載せる
4. 受信側は通常の PAT / OAuth / integration-managed credential として検証する
