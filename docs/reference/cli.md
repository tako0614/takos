# CLI

Takos CLI は、認証、manifest の preview / deploy、repository deploy、group
inventory、task-oriented API surface を扱う current public entrypoint です。
compute / route / publish の個別 CRUD は public CLI では出しません。 resource は
`takos resource|res` で low-level CRUD を提供します。

## 二層モデル

Takos の deploy system は二層構造ですが、CLI は current public surface として
group bulk operations を中心に提供します。primitive は control-plane の internal
model です。

- **Layer 1: primitive (foundation)** — compute (worker / service / attached) /
  route / publish。これらの個別操作は public CLI では提供しない
- **Layer 1b: resource (low-level)** — `takos resource|res` で resource /
  provider-backed resource の CRUD を扱う
- **Layer 2: group (上位 bundling)** — primitive 群を束ねた bulk lifecycle
  unit。 manifest 経由で `takos deploy` / `takos install` / `takos rollback`
  を使う

primitive を group に束ねるかどうかは optional。standalone primitive と
group-attached primitive はどちらも 1st-class エンティティです。

## deploy entrypoint

`.takos/app.yml` を直接扱うのは `takos deploy` で、ローカル manifest からの
deploy（primary）と repository URL からの
deploy（alternative）の両方を扱います。 preview は
`takos deploy --plan --space SPACE_ID` を使います。`takos apply` と `takos plan`
は legacy compatibility command として残っています。`takos install` は catalog
経由で `takos deploy` を呼ぶ sugar です。 public spec は Cloudflare-native
で、実行モデルは Takos runtime です。

`takos deploy` はローカル working tree 由来でも repo/ref source
由来でも、いずれも 同じ pipeline を通り、immutable な app deployment
record（snapshot）を作ります。 API の source kind はローカル manifest では
`manifest`、repo/ref では `git_ref` です。CLI / UI の表示名として `local` /
`repo:owner/repo@ref` を使いますが、これは manifest の出どころを 示す metadata
であり、lifecycle の差ではありません。どちらの経路で deploy された group も
`takos rollback GROUP_NAME --space SPACE_ID` で snapshot を再適用できます。

## Top-level

### 認証

| command              | 説明                              |
| -------------------- | --------------------------------- |
| `takos login`        | CLI 認証                          |
| `takos whoami`       | 現在のユーザー / space 情報を表示 |
| `takos logout`       | 保存済み認証情報を削除            |
| `takos endpoint ...` | 接続先管理                        |

### Layer 2: group bulk operations

| command                  | 説明                                                         |
| ------------------------ | ------------------------------------------------------------ |
| `takos deploy`           | ローカル manifest または repository URL から group を deploy |
| `takos deploy --plan`    | `.takos/app.yml` の non-mutating preview（dry-run）          |
| `takos install`          | `takos deploy` の sugar。catalog で owner/repo を解決        |
| `takos rollback <group>` | group の直前 snapshot を再適用                               |
| `takos uninstall`        | group を terminal uninstall して managed resources を削除    |
| `takos group ...`        | group inventory / desired state の参照と管理                 |

### Legacy compatibility

| command       | 説明                                 |
| ------------- | ------------------------------------ |
| `takos apply` | `takos deploy` の互換 surface        |
| `takos plan`  | `takos deploy --plan` の互換 surface |

> compute (worker / service) の個別 CRUD は `/api/services/*` HTTP API 経由で
> 行います。CLI には primitive 個別サブコマンドはありません。

`takos api ...` は removed legacy surface です。current CLI には含めません。
`takos deploy` / `takos deploy --plan` が current preferred flow です。
`takos apply` と `takos plan` は legacy compatibility command
として残っています。

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

positional argument を省略するとローカルの `.takos/app.yml` を source にします。
URL を渡すとその repository を source にします。 `TAKOS_WORKSPACE_ID` または
`.takos-session` で既定 workspace が決まっている場合は `--space`
を省略できます。

| option                     | 説明                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| positional `repositoryUrl` | (optional) canonical HTTPS git repository URL。省略時はローカル manifest |
| `--plan`                   | dry-run preview（実際には apply しない）                                 |
| `--manifest <path>`        | manifest path。既定は `.takos/app.yml`（ローカル deploy 時）             |
| `--auto-approve`           | 確認プロンプトを省略                                                     |
| `--target <key...>`        | 一部だけ反映。diff entry 名を指定する。例: `web`, `web:/`                |
| `--ref <ref>`              | branch / tag / commit（repo URL 指定時）                                 |
| `--ref-type <type>`        | `branch` / `tag` / `commit`（repo URL 指定時）                           |
| `--group <name>`           | 対象 group 名。省略時は `name`                                           |
| `--env <name>`             | target env                                                               |
| `--provider <provider>`    | `cloudflare`, `local`, `aws`, `gcp`, `k8s`                               |
| `--space <id>`             | 対象 space ID                                                            |
| `--json`                   | JSON 出力                                                                |

`takos deploy --plan --space SPACE_ID` は non-mutating preview です。group
が未作成でも DB row は作りません。`takos deploy --space SPACE_ID` /
`takos deploy --plan --space SPACE_ID` はどちらも provider translation report
を表示します。表示は `Spec: Cloudflare-native` と `Runtime: Takos runtime`
を前提にしつつ、どの backend でその spec を実現するかを 示します。未接続の
provider / resource / workload / route が含まれる場合は fail-fast
で終了します。`takos apply` と `takos plan` は legacy compatibility command
として残っています。

ローカル deploy と repo deploy はどちらも同じ pipeline を通り、同じ immutable
snapshot を作ります。違いは「manifest がどこから来るか」という provenance だけ
で、`takos rollback GROUP_NAME --space SPACE_ID` でいずれの group
も巻き戻せます。

| 観点            | local manifest deploy                                           | repo URL deploy                                                 |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| source          | local working tree                                              | `repository_url + ref/ref_type`                                 |
| source 解決     | CLI が manifest / artifact を読む                               | control plane が repo source を解決                             |
| snapshot 作成   | immutable snapshot を作る                                       | immutable snapshot を作る                                       |
| rollback        | `takos rollback GROUP_NAME --space SPACE_ID` で snapshot 再適用 | `takos rollback GROUP_NAME --space SPACE_ID` で snapshot 再適用 |
| API source kind | `manifest`                                                      | `git_ref`                                                       |
| 表示名          | `local`                                                         | `repo:owner/repo@ref`                                           |

サブコマンド:

| command                    | 説明            |
| -------------------------- | --------------- |
| `takos deploy status`      | deployment 一覧 |
| `takos deploy status <id>` | deployment 詳細 |

## `takos rollback`

```bash
takos rollback my-app --space SPACE_ID    # 直前の snapshot に戻す
```

`takos rollback GROUP_NAME --space SPACE_ID` は group に対する rollback
操作です。前回成功した deployment の immutable snapshot を再適用します。

- 引数は group 名（省略不可）
- group row が既に削除されている場合は失敗し、deleted group を再生成しない
- code + config + publication outputs は戻るが、DB / object-store / key-value
  のデータは 戻らない（forward-only migration）

| option                 | 説明                       |
| ---------------------- | -------------------------- |
| positional `groupName` | (required) 対象の group 名 |
| `--space <id>`         | 対象 space ID              |

## `takos install`

```bash
takos install owner/repo --space SPACE_ID --version v1.0.0    # explicit flag
```

`--version v1.0.0` で version を指定します。

catalog metadata から `repository_url + release tag` を解決して app deployment
を作成します。target space に Store app が install されている必要はありません。

## `takos uninstall`

```bash
takos uninstall GROUP_NAME --space SPACE_ID
```

group の desired state を empty に apply し、managed resources を削除してから
group row も削除します。`takos uninstall` は terminal 操作で、あとから rollback
で deleted group を再生成することはできません。

## `takos group`

| command                                         | 説明                                 |
| ----------------------------------------------- | ------------------------------------ |
| `takos group list`                              | group 一覧                           |
| `takos group show <name>`                       | group inventory 表示                 |
| `takos group delete <name>`                     | 空の group を削除                    |
| `takos group desired get <name>`                | group の desired app manifest を取得 |
| `takos group desired put <name> --file app.yml` | group の desired app manifest を置換 |

API-backed group commands は `--space SPACE_ID` を受け付けます。
`TAKOS_WORKSPACE_ID` または `.takos-session` で default workspace
が解決できる場合だけ 省略できます。

## `takos resource` / `takos res`

| command                                  | 説明                                     |
| ---------------------------------------- | ---------------------------------------- |
| `takos resource list`                    | resource 一覧                            |
| `takos resource show <name>`             | resource 詳細                            |
| `takos resource create <name>`           | resource を作成                          |
| `takos resource delete <name>`           | resource を削除                          |
| `takos resource bind <name>`             | worker / service に resource を bind     |
| `takos resource unbind <name>`           | worker / service から resource を unbind |
| `takos resource attach <name>`           | group に resource を attach              |
| `takos resource detach <name>`           | group から resource を detach            |
| `takos resource sql tables <name>`       | SQL resource の tables を表示            |
| `takos resource sql query <name> <sql>`  | SQL resource に query を実行             |
| `takos resource object ls <name>`        | object resource の一覧                   |
| `takos resource object get <name> <key>` | object を取得                            |
| `takos resource object put <name> <key>` | object を保存                            |
| `takos resource object rm <name> <key>`  | object を削除                            |
| `takos resource kv ls <name>`            | KV resource の一覧                       |
| `takos resource kv get <name> <key>`     | KV entry を取得                          |
| `takos resource kv put <name> <key>`     | KV entry を保存                          |
| `takos resource kv rm <name> <key>`      | KV entry を削除                          |
| `takos resource get-secret <name>`       | secret を表示                            |
| `takos resource rotate-secret <name>`    | secret をローテーション                  |

## Primitive 個別操作

primitive (compute / route / publish) は control-plane の internal model
です。current public CLI surface では個別 CRUD を提供せず、compute / route は
`/api/services/*` HTTP API で管理します。resource / provider-backed resource は
`takos resource|res` の low-level surface か `/api/resources/*` と
`/api/publications/*` で管理します。

```bash
# compute / route は HTTP API を直接呼び出す
POST   /api/services
PATCH  /api/services/:id
PATCH  /api/services/:id/group
DELETE /api/services/:id
POST   /api/services/:id/custom-domains
POST   /api/services/:id/custom-domains/:domainId/verify
```

manifest 経由の `takos deploy` と組み合わせて、group bulk lifecycle と control
plane の個別管理を分けて扱います。

## Task-oriented CLI

Takos CLI では、単純な HTTP verb 直叩きではなく `domain + task` を使います。

```bash
takos workspace list
takos repo create --body '{"name":"my-repo"}'
takos run follow RUN_ID --transport ws
takos discover list /explore/repos
```

代表的な domain:

| domain               | base path / 役割                   |
| -------------------- | ---------------------------------- |
| `workspace` (`ws`)   | `/api/spaces`                      |
| `repo`               | `/api/repos`                       |
| `run`                | `/api/runs`                        |
| `app`                | `/api/apps`                        |
| `discover`           | `/api` 配下の discover/search      |
| `capability` (`cap`) | `/api` 配下の skills / tools       |
| `context` (`ctx`)    | `/api` 配下の memories / reminders |
| `auth`               | `/api/auth/*` と `/api/me/oauth/*` |

service 系 (`/api/services`) の CRUD / custom domains / deployment status は
current HTTP API surface として残っており、直接 `/api/services/*` を呼び出して
操作します。

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

stream 対応 domain は追加で `watch` と `follow` を持ちます。

## Legacy compatibility / removed surface

Takos CLI は current preferred surface と compatibility surface
を分けて扱います。

- `takos apply`（`takos deploy` の compatibility surface）
- `takos plan`（`takos deploy --plan` の compatibility surface）
- `takos api ...`
- 直接的な HTTP verb style subcommand
- `takos build`
- `takos publish`
- `takos promote`

## 次に読むページ

- [CLI / Auth model](/reference/cli-auth)
- [Deploy System](/deploy/)
- [API リファレンス](/reference/api)
