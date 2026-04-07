# CLI

Takos CLI は、認証、manifest の preview / deploy、repository deploy、group
inventory、task-oriented API surface を扱う current public entrypoint です。

## 二層モデル

Takos の deploy system は二層構造になっており、CLI もそれに沿って primitive と
group の両方を 1st-class でサポートします。

- **Layer 1: primitive (foundation)** — compute (worker / service / attached) /
  storage / route / publish。task-oriented CLI (`takos service`,
  `takos resource`, ...) で個別に CRUD する
- **Layer 2: group (上位 bundling)** — primitive 群を束ねた bulk lifecycle unit。
  manifest 経由で `takos deploy` / `takos install` / `takos rollback` を使う

primitive を group に束ねるかどうかは optional。standalone primitive と
group-attached primitive はどちらも 1st-class エンティティです。

## deploy entrypoint

`.takos/app.yml` を直接扱うのは `takos deploy` で、ローカル manifest からの
deploy（primary）と repository URL からの deploy（alternative）の両方を扱います。
preview は `takos deploy --plan` を使います（standalone の `takos plan` コマンドは
ありません）。`takos install` は catalog 経由で `takos deploy` を呼ぶ sugar です。
public spec は Cloudflare-native で、実行モデルは Takos runtime です。

`takos deploy` はローカル working tree 由来でも repo/ref source 由来でも、いずれも
同じ pipeline を通り、immutable な app deployment record（snapshot）を作ります。
group の `source` field（`local` / `repo:owner/repo@ref`）は manifest の出どころを
示す metadata であり、lifecycle の差ではありません。どちらの経路で deploy された
group も `takos rollback GROUP_NAME` で snapshot を再適用できます。

## Top-level

### 認証

| command | 説明 |
| --- | --- |
| `takos login` | CLI 認証 |
| `takos whoami` | 現在のユーザー / space 情報を表示 |
| `takos logout` | 保存済み認証情報を削除 |
| `takos endpoint ...` | 接続先管理 |

### Layer 2: group bulk operations

| command | 説明 |
| --- | --- |
| `takos deploy` | ローカル manifest または repository URL から group を deploy |
| `takos deploy --plan` | `.takos/app.yml` の non-mutating preview（dry-run） |
| `takos install` | `takos deploy` の sugar。catalog で owner/repo を解決 |
| `takos rollback <group>` | group の直前 snapshot を再適用 |
| `takos uninstall` | group を terminal uninstall して managed resources を削除 |
| `takos group ...` | group inventory / desired state の参照と管理 |

### Layer 1: primitive 個別操作

| command | 説明 |
| --- | --- |
| `takos service ...` | compute (worker / service) の個別 CRUD |
| `takos resource ...` | storage (sql / object-store / kv / queue / ...) の個別 CRUD |
| `takos worker ...` | worker domain (alias / 互換) |
| `takos app ...` | app domain |
| `takos <domain> <task>` | その他 task-oriented API command |

`takos api ...` は removed legacy surface です。current CLI には含めません。
`takos apply` は廃止され、`takos deploy` に統合されました。
`takos plan` という standalone command はありません。preview は `takos deploy --plan` を使います。

## 認証

```bash
takos login
takos whoami
takos logout
```

詳しい認証モデルは [CLI / Auth model](/reference/cli-auth) を参照。

## `takos deploy`

`takos deploy` は Takos の唯一の deploy entrypoint です。ローカル manifest からの
deploy（primary）と repository URL からの deploy（alternative）を一つのコマンドで
扱います。

```bash
takos deploy                          # from local .takos/app.yml
takos deploy --env staging            # with environment
takos deploy https://github.com/...   # from repo URL
takos deploy --plan                   # dry-run preview
```

positional argument を省略するとローカルの `.takos/app.yml` を source にします。
URL を渡すとその repository を source にします。

| option | 説明 |
| --- | --- |
| positional `repositoryUrl` | (optional) canonical HTTPS git repository URL。省略時はローカル manifest |
| `--plan` | dry-run preview（実際には apply しない） |
| `--manifest <path>` | manifest path。既定は `.takos/app.yml`（ローカル deploy 時） |
| `--auto-approve` | 確認プロンプトを省略 |
| `--target <key...>` | 一部だけ反映。例: `compute.web`, `storage.primary-db` |
| `--ref <ref>` | branch / tag / commit（repo URL 指定時） |
| `--ref-type <type>` | `branch` / `tag` / `commit`（repo URL 指定時） |
| `--group <name>` | 対象 group 名。省略時は `name` |
| `--env <name>` | target env |
| `--provider <provider>` | `cloudflare`, `local`, `aws`, `gcp`, `k8s` |
| `--space <id>` | 対象 space ID |
| `--json` | JSON 出力 |

`takos deploy --plan` は non-mutating preview です。group が未作成でも DB row
は作りません。`takos deploy` / `takos deploy --plan` はどちらも provider
translation report を表示します。表示は `Spec: Cloudflare-native` と
`Runtime: Takos runtime` を前提にしつつ、どの backend でその spec を実現するかを
示します。未接続の provider / resource / workload / route が含まれる場合は
fail-fast で終了します。standalone の `takos plan` コマンドはありません。

ローカル deploy と repo deploy はどちらも同じ pipeline を通り、同じ immutable
snapshot を作ります。違いは「manifest がどこから来るか」という provenance だけ
で、`takos rollback GROUP_NAME` でいずれの group も巻き戻せます。

| 観点 | local manifest deploy | repo URL deploy |
| --- | --- | --- |
| source | local working tree | `repository_url + ref/ref_type` |
| source 解決 | CLI が manifest / artifact を読む | control plane が repo source を解決 |
| snapshot 作成 | immutable snapshot を作る | immutable snapshot を作る |
| rollback | `takos rollback GROUP_NAME` で snapshot 再適用 | `takos rollback GROUP_NAME` で snapshot 再適用 |
| source 表記 | `local` | `repo:owner/repo@ref` |

サブコマンド:

| command | 説明 |
| --- | --- |
| `takos deploy status` | deployment 一覧 |
| `takos deploy status <id>` | deployment 詳細 |

## `takos rollback`

```bash
takos rollback my-app               # 直前の snapshot に戻す
```

`takos rollback GROUP_NAME` は group に対する rollback 操作です。前回成功した
deployment の immutable snapshot を再適用します。

- 引数は group 名（省略不可）
- group row が既に削除されている場合は失敗し、deleted group を再生成しない
- code + config + bindings は戻るが、DB / object-store / key-value のデータは
  戻らない（forward-only migration）

| option | 説明 |
| --- | --- |
| positional `groupName` | (required) 対象の group 名 |
| `--space <id>` | 対象 space ID |

## `takos install`

```bash
takos install owner/repo --version v1.0.0    # explicit flag
takos install owner/repo@v1.0.0              # shorthand
```

`--version v1.0.0` と `owner/repo@v1.0.0` は等価です。どちらを使っても同じ挙動に
なります。

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

| command | 説明 |
| --- | --- |
| `takos group list` | group 一覧 |
| `takos group show <name>` | group inventory 表示 |
| `takos group delete <name>` | 空の group を削除 |
| `takos group desired get <name>` | group の desired app manifest を取得 |
| `takos group desired put <name> --file app.yml` | group の desired app manifest を置換 |

## Primitive 個別操作

primitive (compute / storage / route / publish) は task-oriented CLI で個別に
CRUD できます。group に所属させない場合 standalone primitive となり、それぞれが
独立した lifecycle unit になります。

```bash
# compute (worker / service) の管理
takos service list
takos service view svc_abc123
takos service create --body '{"name":"my-api","space_id":"ws_xxx"}'
takos service remove svc_abc123

# storage (resource) の管理
takos resource list
takos resource create --body '{"name":"my-db","type":"sql","space_id":"ws_xxx"}'
takos resource view res_xxx
takos resource remove res_xxx

# binding (storage を compute に紐付け)
takos resource bind res_xxx --service svc_abc123
takos resource bind remove res_xxx --service svc_abc123

# custom domain (route)
takos service custom-domain list svc_abc123
takos service custom-domain create svc_abc123 --body '{"domain":"api.example.com"}'
takos service custom-domain verify svc_abc123 dom_xxx

# 既存の standalone primitive を group に所属させる
takos service update svc_abc123 --body '{"group":"my-app"}'
takos resource update res_xxx --body '{"group":"my-app"}'
```

primitive 操作は kernel data model 上の 1st-class エンティティに直接アクセスし
ます。manifest 経由の `takos deploy` と組み合わせて、group bulk lifecycle と
個別 lifecycle のどちらも自由に使えます。

## Task-oriented CLI

Takos CLI では、単純な HTTP verb 直叩きではなく `domain + task` を使います。

```bash
takos space list
takos repo create --body '{"name":"my-repo"}'
takos run follow RUN_ID --transport ws
takos discover list /explore/repos
```

代表的な domain:

| domain | base path / 役割 |
| --- | --- |
| `workspace` (`ws`) | `/api/spaces` |
| `repo` | `/api/repos` |
| `run` | `/api/runs` |
| `worker` | `/api/workers` |
| `app` | `/api/apps` |
| `resource` | `/api/resources` |
| `discover` | `/api` 配下の discover/search |
| `capability` (`cap`) | `/api` 配下の skills / tools |
| `context` (`ctx`) | `/api` 配下の memories / reminders |
| `auth` | `/api/auth/*` と `/api/me/oauth/*` |

service 系の task domain も current HTTP surface として残っており、
`/api/services` 配下の CRUD / custom domains / deployment status を扱います。

### 共通 task verb

| verb | HTTP method | 役割 |
| --- | --- | --- |
| `list` | GET | 一覧取得 |
| `view` | GET | 詳細取得 |
| `create` | POST | 作成 |
| `replace` | PUT | 全置換 |
| `update` | PATCH | 部分更新 |
| `remove` | DELETE | 削除 |
| `probe` | HEAD | 存在確認 |
| `describe` | OPTIONS | 利用可能な操作の確認 |

stream 対応 domain は追加で `watch` と `follow` を持ちます。

## Removed legacy surface

Takos CLI は次を current surface に含めません。

- `takos apply`（`takos deploy` に統合）
- `takos api ...`
- 直接的な HTTP verb style subcommand
- `takos build`
- `takos publish`
- `takos promote`

## 次に読むページ

- [CLI / Auth model](/reference/cli-auth)
- [Deploy System](/deploy/)
- [API リファレンス](/reference/api)
