# CLI

Takos CLI は、認証、manifest の preview / deploy、repository deploy、group
inventory、task-oriented API surface を扱う current public entrypoint です。
compute / route / publication の個別 CRUD は public CLI では出しません。
resource は `takos resource|res` で個別 CRUD を提供します。

## deploy model

Takos の CLI は manifest / repository / catalog source から primitive
declaration を apply する surface を提供します。group は primitive
を任意に束ねる state scope で、inventory、deployment history、rollback、uninstall などの
group 機能を持ちます。resource API / runtime binding と publish catalog
は分けます。`publish` は route/interface metadata の共有に使い、Takos API key /
OAuth client は built-in provider publication を `consume` します。SQL /
object-store / queue などの resource API / runtime binding とは分けます。

- **Primitive records** — workload / route / publication / resource / consume
  edge などの個別 record
- **Group features** — group inventory、deployment history、rollback、uninstall、updates
- **Resource surface** — `takos resource|res` で resource CRUD を扱う

group 所属は primitive が group 機能を使えることを意味します。group なしの
service / route / publication も同じ primitive model で扱います。

public task-oriented surface の domain は次の通りです。

- `me`
- `setup`
- `space`
- `thread`
- `run`
- `task`
- `repo`
- `app`
- `git`
- `capability` / `cap`
- `context` / `ctx`
- `shortcut`
- `notification`
- `public-share`
- `auth`
- `discover`

## deploy entrypoint

`.takos/app.yml` / `.takos/app.yaml` を直接扱うのは `takos deploy` で、ローカル
manifest からの deploy（primary）と repository URL からの
deploy（alternative）の両方を扱います。preview は
`takos deploy --plan --space SPACE_ID`
を使います。`takos install` は catalog 経由で `takos deploy` を呼ぶ sugar
です。public spec は backend-neutral で、 実行モデルは tenant runtime
です。`takos deploy` / `takos install` は group deployment history を使い、
manifest の `name` を group 名として使います。`--group` は override です。

`takos deploy` はローカル working tree 由来でも repo/ref source 由来でも同じ
pipeline を通り、明示した group inventory へ primitive declaration を apply
します。deployment record も作ります。API の source kind はローカル manifest では
`manifest`、repo/ref では `git_ref` です。CLI / UI の表示名として `local` /
`repo:owner/repo@ref` を使いますが、これは manifest の出どころを示す metadata
であり、lifecycle の差ではありません。

ローカル manifest 経路では、CLI が `build.fromWorkflow` の workflow を
workflow-runner でローカル実行し、生成した build artifact を `source.artifacts`
として送ります。repository URL 経路では CLI は repo を fetch せず、control plane
に `repository_url + ref/ref_type` を渡します。

## Top-level

### 認証

| command              | 説明                              |
| -------------------- | --------------------------------- |
| `takos login`        | CLI 認証                          |
| `takos whoami`       | 現在のユーザー / space 情報を表示 |
| `takos logout`       | 保存済み認証情報を削除            |
| `takos endpoint ...` | 接続先管理                        |

### Deploy / group operations

| command                  | 説明                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| `takos deploy`           | ローカル manifest または repository URL から group inventory へ primitive declaration を apply |
| `takos deploy --plan`    | `.takos/app.yml` / `.takos/app.yaml` の group-scoped non-mutating preview（dry-run）           |
| `takos install`          | `takos deploy` の sugar。catalog で owner/repo を解決                                          |
| `takos rollback <group>` | 前回成功 deployment record を再適用                                                            |
| `takos uninstall`        | group を terminal uninstall して manifest-managed primitive を削除                             |
| `takos group ...`        | group inventory / declaration / group 機能の参照と管理                                         |

> compute (worker / service) の個別 CRUD は `/api/services/*` HTTP API 経由で
> 行います。public CLI にある個別 record 系は `takos resource|res` のみで、
> compute / route / publication の個別 CRUD サブコマンドはありません。

## 認証

```bash
takos login
takos whoami
takos logout
```

詳しい認証モデルは [CLI / Auth model](/reference/cli-auth) を参照。

## `takos deploy`

`takos deploy` は Takos の current preferred deploy entrypoint です。ローカル
manifest からの deploy（primary）と repository URL からの
deploy（alternative）の両方を 一つのコマンドで扱います。

```bash
takos deploy --space SPACE_ID                         # from local .takos/app.yml
takos deploy --env staging --space SPACE_ID           # with environment
takos deploy https://github.com/... --space SPACE_ID  # from repo URL
takos deploy --plan --space SPACE_ID                  # dry-run preview
```

positional argument を省略するとローカルの `.takos/app.yml` または
`.takos/app.yaml` を source にします。URL を渡すとその repository を source
にします。`TAKOS_SPACE_ID` または `.takos-session` で既定 space
が決まっている場合は `--space` を省略できます。

| option                     | 説明                                                                             |
| -------------------------- | -------------------------------------------------------------------------------- |
| positional `repositoryUrl` | (optional) canonical HTTPS git repository URL。省略時はローカル manifest         |
| `--plan`                   | dry-run preview（実際には変更を反映せず、deploy もしない）                       |
| `--manifest <path>`        | manifest path。既定は `.takos/app.yml` / `.takos/app.yaml`（ローカル deploy 時） |
| `--auto-approve`           | 確認プロンプトを省略                                                             |
| `--target <key...>`        | `--plan` 時のみ使う diff entry filter。例: `web`, `web:/`                        |
| `--ref <ref>`              | branch / tag / commit（repo URL 指定時）                                         |
| `--ref-type <type>`        | `branch` / `tag` / `commit`（repo URL 指定時、CLI で choice validation）         |
| `--group <name>`           | manifest の `name` から決まる group 名を override する                           |
| `--env <name>`             | target env                                                                       |
| `--space <id>`             | 対象 space ID                                                                    |
| `--json`                   | JSON 出力                                                                        |

`repositoryUrl` と `--manifest` を同時に渡した場合はエラーになります。

`takos deploy --plan --space SPACE_ID` は non-mutating preview
です。group が未作成でも DB row
は作りません。`takos deploy --space SPACE_ID` /
`takos deploy --plan --space SPACE_ID` はどちらも runtime
translation report を表示します。表示は
`Spec: Takos deploy manifest`、`Runtime: tenant runtime`、 `Surface: Portable`
を前提にしつつ、compiled workload / route を tenant runtime へ渡すための backend
requirement preflight を示します。backend / adapter 名は operator-only
configuration であり、通常の report には出しません。runtime translation report
が扱うのは `desiredState.workloads` / `desiredState.routes` と runtime
が満たすべき operator/backend 要件です。未接続の workload / route は fail-fast
で終了しますが、この report は full runtime compatibility や resource API /
runtime binding の存在確認を判定しません。`compatible` は schema / translation
parity であり、behavior parity や provider resource existence ではありません。

`--target` は `takos deploy --plan` と `takos install --plan` でだけ使えます。
target は diff entry 名で、`web`, `web:/` のほか `workers.web`, `routes.web:/`
のような dotted category key も受け付けます。ローカル manifest 経路では、
`compute.<name>.build.fromWorkflow.artifactPath` を local artifact collection の
入力として CLI が API call 前に確認します。`artifactPath` は public manifest
schema では optional の local/private build metadata ですが、local deploy で
worker bundle を収集する場合は必要です。worker bundle が見つからない場合 や
directory 内に複数の JavaScript bundle 候補がある場合は `takos deploy
--plan`
でも `takos deploy` でも失敗します。

ローカル deploy と repo deploy はどちらも同じ pipeline を通ります。違いは
「manifest がどこから来るか」という provenance だけです。deployment record
がある場合は `takos rollback GROUP_NAME --space SPACE_ID` で再適用できます。

| 観点            | local manifest flow                                     | repo URL deploy                                         |
| --------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| source          | local working tree                                      | `repository_url + ref/ref_type`                         |
| source 解決     | CLI が manifest / artifact を読む                       | control plane が repo source を解決                     |
| primitive apply | worker / service / route / publication / consume を apply | worker / service / route / publication / consume を apply |
| deployment record | group 指定時に作る                                    | group 指定時に作る                                      |
| rollback        | 前回成功 record がある場合に再適用                      | 前回成功 record がある場合に再適用                      |
| API source kind | `manifest`                                              | `git_ref`                                               |
| 表示名          | `local`                                                 | `repo:owner/repo@ref`                                   |

サブコマンド:

| command                    | 説明                |
| -------------------------- | ------------------- |
| `takos deploy status`      | deployment record 一覧 |
| `takos deploy status <id>` | deployment record 詳細 |

`takos deploy status` は `--space <id>` と `--json` を受け付けます。

## `takos rollback`

```bash
takos rollback my-app --space SPACE_ID    # 前回成功 record に戻す
```

`takos rollback GROUP_NAME --space SPACE_ID` は group に対する rollback
操作です。前回成功した deployment record を再適用します。

- 引数は group 名（省略不可）
- group row が既に削除されている場合は失敗し、deleted group を再生成しない
- code + config + publication outputs は戻るが、DB / object-store / key-value
  のデータは 戻らない（forward-only migration）

| option                 | 説明                       |
| ---------------------- | -------------------------- |
| positional `groupName` | (required) 対象の group 名 |
| `--space <id>`         | 対象 space ID              |
| `--json`               | JSON 出力                  |

## `takos install`

`takos install` は Store / catalog item を install する deploy sugar です。通常
path は `takos deploy` / `takos deploy --plan` で、`takos install` は catalog
で owner/repo と version/tag を repository source に解決したうえで同じ deploy
pipeline に入れます。

```bash
takos install owner/repo --space SPACE_ID --version v1.0.0
```

`takos install` は `--version`、`--group`、`--env`、`--space`、`--target`、
`--plan`、`--json` を受け付けます。`--version` は package catalog の release
version または tag を指定し、未指定時は latest package を使います。`--group` は
manifest の `name` 由来の deploy group 名を override し、`--env` は target env を指定します。`--target` は
`takos install --plan` でだけ使う diff entry filter です。`--plan` は
non-mutating preview、`--json` は JSON 出力です。

catalog metadata から `repository_url + Git tag`
を解決し、`source.kind = "git_ref"` / `ref_type = "tag"` で同じ deploy pipeline
に入れます。group を指定した場合は deployment record を作成します。target space に
Store app-label / package が install されている必要はありません。

`takos install` が必要とする Store の latest / versions レスポンスでは、
`repository_url`、`release.tag`、`version` が返る必要があります。

## `takos uninstall`

```bash
takos uninstall GROUP_NAME --space SPACE_ID
```

group-scoped declaration を empty に apply し、manifest-managed workload / route
/ publication を削除してから group row も削除します。`takos uninstall` は
terminal 操作で、あとから rollback で deleted group
を再生成することはできません。

| option                 | 説明                       |
| ---------------------- | -------------------------- |
| positional `groupName` | (required) 対象の group 名 |
| `--space <id>`         | 対象 space ID              |
| `--json`               | JSON 出力                  |

## `takos group`

| command                     | 説明                 |
| --------------------------- | -------------------- |
| `takos group list`          | group 一覧           |
| `takos group show <name>`   | group inventory 表示 |
| `takos group delete <name>` | 空の group を削除    |

API-backed group commands は `--space SPACE_ID` を受け付けます。
`TAKOS_SPACE_ID` または `.takos-session` で default space が解決できる場合だけ
省略できます。

| command               | options                                |
| --------------------- | -------------------------------------- |
| `group list`          | `--space <id>`, `--json`, `--offline`  |
| `group show <name>`   | `--space <id>`, `--json`, `--offline`  |
| `group delete <name>` | `--space <id>`, `--force`, `--offline` |

deploy manifest の preview / apply は `takos deploy --plan` / `takos deploy`
を使います。group-scoped declaration の直接取得・置換は HTTP API の advanced
surface で、通常の deploy path ではありません。

## `takos resource` / `takos res`

| command                                     | 説明                                     |
| ------------------------------------------- | ---------------------------------------- |
| `takos resource list`                       | resource 一覧                            |
| `takos resource show <name>`                | resource 詳細                            |
| `takos resource create <name>`              | resource を作成                          |
| `takos resource delete <name>`              | resource を削除                          |
| `takos resource bind <name>`                | worker / service に resource を bind     |
| `takos resource unbind <name>`              | worker / service から resource を unbind |
| `takos resource attach <name>`              | group に resource を attach              |
| `takos resource detach <name>`              | group から resource を detach            |
| `takos resource sql tables <name>`          | SQL resource の tables を表示            |
| `takos resource sql query <name> <sql>`     | SQL resource に query を実行             |
| `takos resource object ls <name>`           | object resource の一覧                   |
| `takos resource object get <name> <key>`    | object を取得                            |
| `takos resource object put <name> <key>`    | object を保存                            |
| `takos resource object rm <name> <key>`     | object を削除                            |
| `takos resource key-value ls <name>`        | key-value resource の一覧                |
| `takos resource key-value get <name> <key>` | key-value entry を取得                   |
| `takos resource key-value put <name> <key>` | key-value entry を保存                   |
| `takos resource key-value rm <name> <key>`  | key-value entry を削除                   |
| `takos resource get-secret <name>`          | secret を表示                            |
| `takos resource rotate-secret <name>`       | secret をローテーション                  |

主要 options:

Cloudflare の account ID / API token は `resource create` / `resource delete` の
CLI option では渡しません。control/server 側の環境変数または secret
設定で管理し、CLI は Takos API 認証と `--space` で対象を指定します。

| command family                      | options                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `resource list/show`                | `--space <id>`, `--json`                                                                                |
| `resource create`                   | `--type`, `--binding`, `--env`, `--group`, `--space`, `--json`                                          |
| `resource delete`                   | `--space <id>`                                                                                          |
| `resource attach/detach`            | `attach --group <name>`, `--space <id>`                                                                 |
| `resource bind/unbind`              | `--binding <binding>` for bind, `--worker <name>`, `--service <name>`, `--group <name>`, `--space <id>` |
| `resource sql`                      | `--space <id>`, `--json`                                                                                |
| `resource object ls/get`            | `ls --prefix <prefix>`, `--space <id>`, `--json`                                                        |
| `resource object put`               | `--value <value>`, `--file <path>`, `--content-type <type>`, `--space <id>`                             |
| `resource object rm`                | `--space <id>`                                                                                          |
| `resource key-value ls/get`         | `ls --prefix <prefix>`, `--space <id>`, `--json`                                                        |
| `resource key-value put/rm`         | `put --value <value>`, `put --file <path>`, `--space <id>`                                              |
| `resource get-secret/rotate-secret` | `--space <id>`, `--json`                                                                                |

`--group` を指定すると、manifest 由来の group-managed workload は compute 名で
解決できます。たとえば `.takos/app.yml` の `compute.web` に resource を bind
する場合は `--group <group-name> --worker web` を使います。

## 個別 record 操作

compute / route / publication と resource record は control-plane の primitive
model です。public CLI surface では compute / route / publication の個別 CRUD
を提供せず、compute / route は `/api/services/*` HTTP API で管理します。resource
は `takos resource|res` か `/api/resources/*` で管理します。

```bash
# compute / route は HTTP API を直接呼び出す
POST   /api/services
PATCH  /api/services/:id
PATCH  /api/services/:id/group
DELETE /api/services/:id
POST   /api/services/:id/custom-domains
POST   /api/services/:id/custom-domains/:domainId/verify
```

manifest 経由の `takos deploy` と組み合わせて、group 機能と control plane の個別
primitive 管理を分けて扱います。

## Task-oriented CLI

Takos CLI では、単純な HTTP verb 直叩きではなく `domain + task` を使います。

```bash
takos space list
takos repo create --body '{"name":"my-repo"}'
takos run follow RUN_ID --transport ws
takos discover list /explore/repos
```

代表的な domain:

| domain               | base path / 役割                   |
| -------------------- | ---------------------------------- |
| `space`              | `/api/spaces`                      |
| `repo`               | `/api/repos`                       |
| `run`                | `/api/runs`                        |
| `app`                | `/api/apps`                        |
| `discover`           | `/api` 配下の discover/search      |
| `capability` (`cap`) | `/api` 配下の skills / tools       |
| `context` (`ctx`)    | `/api` 配下の memories / reminders |
| `auth`               | `/api/auth/*` と `/api/me/oauth/*` |

service 系 (`/api/services`) の CRUD / custom domains / deployment status は
current HTTP API surface として残っており、直接 `/api/services/*` を呼び出して
操作します。custom domain の TLS は Cloudflare custom-hostname provider が
設定されている場合だけ Cloudflare-managed です。それ以外の hosting surface では
operator-managed / external TLS を使います。

### 共通 task verb

| verb       | HTTP method | 役割                 |
| ---------- | ----------- | -------------------- |
| `list`     | GET         | 一覧取得             |
| `view`     | GET         | 詳細取得             |
| `create`   | POST        | 作成                 |
| `replace`  | PUT         | 全置換               |
| `update`   | PATCH       | 部分更新             |
| `remove`   | DELETE      | 削除                 |
| `probe`    | HEAD        | 存在確認             |
| `describe` | OPTIONS     | 利用可能な操作の確認 |

stream 対応 domain は追加で `watch` と `follow` を持ちます。`watch` と
`takos run follow` は WebSocket / SSE を選べます。`takos repo follow` は
repository action run stream 用で、現在は WebSocket のみです。

common task options:

- `--query <key=value>`: repeatable query parameter
- `--header <key=value>`: repeatable additional header
- `--space <id>`: `X-Takos-Space-Id` の上書き
- `--json`: machine-readable JSON output
- body / form / output options:
  - `--body <json>`
  - `--body-file <path>`
  - `--raw-body <text>`
  - `--raw-body-file <path>`
  - `--content-type <mime>`
  - `--form <key=value>` (repeatable)
  - `--form-file <key=path>` (repeatable)
  - `--output <path>`
- stream options (`watch` / `run follow`):
  - `--transport <ws|sse>`
  - `--last-event-id <id>` (SSE only)
  - `--send <message>` (repeatable, WS connection 後に送信)
- stream options (`repo follow`):
  - `--transport <ws>` (WebSocket only)
  - `--send <message>` (repeatable, WS connection 後に送信)

## 次に読むページ

- [CLI / Auth model](/reference/cli-auth)
- [Deploy System](/deploy/)
- [API リファレンス](/reference/api)
