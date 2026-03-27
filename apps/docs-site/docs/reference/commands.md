# CLI command reference

<!-- docs:cli-top-level login,whoami,logout,deploy,endpoint -->
<!-- docs:cli-domains me,setup,workspace,project,thread,run,artifact,task,repo,worker,app,resource,git,capability,context,shortcut,notification,public-share,auth,discover -->

::: tip Status
このページは current public CLI contract を正本にしつつ、binary registry に残る compatibility-only entry も明示します。Takos CLI は task-oriented で、`takos api ...` や HTTP verb style subcommand は current surface ではありません。
:::

## このリファレンスで依存してよい範囲

- top-level command の current surface
- task domain と共通 verb の考え方
- representative usage

## このリファレンスで依存してはいけない範囲

- hidden legacy command を current CLI だとみなすこと
- task domain の存在だけで全 API family の wire contract を推定すること
- internal/debug command をここにないまま採用すること

## Top-level commands

### auth

```bash
takos login
takos whoami
takos logout
```

### endpoint

```bash
takos endpoint use test
takos endpoint use prod
takos endpoint use https://api.takos.dev
takos endpoint show
```

### deploy

```bash
takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos deploy validate
takos deploy status --space SPACE_ID
takos deploy status APP_DEPLOYMENT_ID --space SPACE_ID
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

`takos deploy` は repo-local `.takos/app.yml` と、指定 repo/ref に紐づく workflow artifact を使って app deployment を作成する current surface です。

## task-oriented model

Takos CLI の中心は `takos <domain> <task>` です。
domain は対象リソースを、task は操作意図を表します。

### Shared task verbs

すべての task domain は共通して次を持ちます。

- `list`
- `view`
- `create`
- `replace`
- `update`
- `remove`
- `probe`
- `describe`

stream 系 domain は追加で次を持ちます。

- `watch`
- `follow`

## Task domains

Takos CLI binary の registry には 20 domain ありますが、current public contract の主説明面に置くのは次の 18 domain です。

| domain | aliases | 主な責務 |
| --- | --- | --- |
| `me` | - | current user / settings |
| `setup` | - | 初期セットアップ |
| `workspace` | `ws` | `/api/spaces` 系 |
| `thread` | - | thread / message |
| `run` | - | run 実行と stream |
| `artifact` | - | artifact 操作 |
| `task` | - | agent task orchestration |
| `repo` | - | repo / pulls / actions |
| `app` | - | app listing / metadata |
| `resource` | - | resource CRUD |
| `git` | - | git 操作 |
| `capability` | `cap` | skills / tools 系 |
| `context` | `ctx` | memories / reminders 系 |
| `shortcut` | - | shortcut 管理 |
| `notification` | - | notification list / stream |
| `public-share` | - | public thread share |
| `auth` | - | auth / OAuth 関連 |
| `discover` | - | search / install 系 |

### Compatibility-only registry entries

次の 2 domain は binary registry に残りますが、current public contract の主説明面には置きません。

| domain | 状態 | 説明 |
| --- | --- | --- |
| `project` | compatibility-only | `/api/projects` に対応する current API family は docs 上の正本に含めない |
| `worker` | compatibility-only | public API family の正本は `/api/services`。`worker` という語は manifest type と UI/internal 名残として残る |

## Representative examples

```bash
takos workspace list
takos workspace create --body '{"name":"my-workspace"}'

takos thread create /spaces/SPACE_ID/threads --body '{"title":"debug"}'
takos run follow RUN_ID --transport sse
takos repo follow REPO_ID RUN_ID --transport ws

takos capability list /spaces/SPACE_ID/skills
takos context list /spaces/SPACE_ID/memories
takos notification watch /sse --transport sse
```

## implementation note

CLI registry 自体には compatibility-only entry (`project`, `worker`) が残ります。
public/current API family との対応を読むときは [API リファレンス](/reference/api) を優先し、service runtime surface は `/api/services` を正本として読みます。
ただし `deploy` domain が触る app deployment surface の end-to-end availability は [Deploy System](/specs/deploy-system) の implementation note を優先してください。

## Removed legacy surface

次は current CLI surface ではありません。

- `takos api ...`
- `takos build`
- `takos publish`
- `takos promote`
- `takos rollback` as a top-level command
- `takos mcp`
- `takos pat`
- `takos pr`
- `takos actions`
- `takos memory`
- `takos reminder`
- `takos skill`
- `takos tool`
- `takos oauth`
- `takos search`
- `takos install`
- `takos <domain> get/post/patch/delete/...`

merge 済み domain の対応は次です。

| old | current |
| --- | --- |
| `pr`, `actions` | `repo` |
| `memory`, `reminder` | `context` |
| `skill`, `tool` | `capability` |
| `oauth` | `auth` |
| `search`, `install` | `discover` |

## 次に読むページ

- [CLI / Auth model](/specs/cli-and-auth)
- [API リファレンス](/reference/api)
- [Deploy System](/specs/deploy-system)
