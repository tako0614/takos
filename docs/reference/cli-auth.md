# CLI / Auth model

Takos CLI は task-oriented です。HTTP verb をそのまま露出するのではなく、domain
ごとの task を前面に出します。

## このページで依存してよい範囲

- `takos login` / `whoami` / `logout` の認証モデル
- CLI がどの順序で認証情報を解決するか
- `endpoint` / `deploy` / task domain の current surface

## このページで依存してはいけない範囲

- control plane 内部の service token 発行処理
- container host / runtime-service 間の internal marker header
- OAuth Device Flow を CLI login の基準だと解釈すること

## implementation note

CLI の deploy surface は [Deploy System](/deploy/) の public contract
に従います。repo URL 経路では CLI は repository URL / ref を control plane
に渡す thin client です。local manifest flow では CLI が deploy manifest
(`.takos/app.yml` / `.takos/app.yaml`) を読み、必要に応じて build artifact
を収集して `source.kind = "manifest"` payload として送ります。build artifact
の収集では workflow-runner が local workflow step を実行します。runtime apply や
rollback の business logic は control plane に置きます。`repositoryUrl` と
`--manifest` の同時指定は CLI で拒否します。

## 認証

### `takos login`

`takos login` はブラウザコールバック方式で認証します。
`takos login --api-url <url>` で接続先 API を明示できます。未指定時は既定の
endpoint 設定を使います。

1. CLI がローカルの一時 HTTP サーバーを起動する
2. ブラウザで `{apiUrl}/auth/cli?callback=...&state=...` を開く
3. ユーザーがブラウザ上で認証を完了する
4. コールバックでトークンを受け取り、ローカル設定へ保存する

```bash
takos login
takos whoami
takos logout
```

::: tip Device Flow との違い
[OAuth の Device Authorization Grant](/apps/oauth#device-authorization-grant-device-flow)
はサードパーティ OAuth client が CLI / IoT
クライアント向けに用意するフローです。`takos login`
自体はブラウザコールバック方式を使い、Device Flow は使いません。:::

## 認証情報の解決順序

CLI は次の順序で認証情報を解決します。

1. 環境変数
2. カレントディレクトリから親方向に探索する `.takos-session`
3. `~/.takos/config.json`

### 環境変数モード

| 環境変数                 | 用途                            |
| ------------------------ | ------------------------------- |
| `TAKOS_SESSION_ID`       | セッション ID による認証        |
| `TAKOS_TOKEN`            | bearer token による認証         |
| `TAKOS_SPACE_ID`         | デフォルト space の指定         |
| `TAKOS_API_URL`          | API endpoint の上書き           |
| `TAKOS_CONFIG_DIR`       | local config dir の上書き       |
| `TAKOS_TIMEOUT_MS`       | CLI timeout の共通上書き        |
| `TAKOS_API_TIMEOUT_MS`   | API request timeout の上書き    |
| `TAKOS_LOGIN_TIMEOUT_MS` | login callback timeout の上書き |

`TAKOS_SESSION_ID` がある場合は `TAKOS_TOKEN` より優先されます。

### session file mode

`.takos-session` は session workdir のための file-based mode です。CLI
は現在地から親方向へ探索し、見つかった場合はその session / space / api_url
を使います。

### local config mode

環境変数と `.takos-session` が無い場合、CLI は `~/.takos/config.json`
を参照します。`takos login` や `takos endpoint use`
が更新するのもこのローカル設定です。

## endpoint 切り替え

endpoint は preset 名またはカスタム URL で切り替えられます。

```bash
takos endpoint use prod
takos endpoint use staging
takos endpoint use local
takos endpoint use https://custom.example.com
takos endpoint show
```

| preset                | URL                     |
| --------------------- | ----------------------- |
| `prod` / `production` | `https://takos.jp`      |
| `staging` / `test`    | `https://test.takos.jp` |
| `local`               | `http://localhost:8787` |

## task-oriented CLI

Takos CLI では、単純な HTTP verb 直叩きではなく `domain + task` を使います。
deploy system は primitive-first model で、worker / service / route /
publication / resource を個別 record として扱います。group は primitive
を任意に束ねる state scope で、snapshot / rollback などの group 機能を持ちます。
CLI は `takos deploy` と group 機能 (`takos rollback`, `takos uninstall`) を
1st-class でサポートします。個別操作のうち resource は `takos resource` /
`takos res` でも扱い、compute / route は control-plane HTTP API
(`/api/services/*`) を使います。`/api/publications/*` は grant 管理 surface
で、MCP / FileHandler などの route publication は deploy manifest の `publish`
で管理します。

```bash
takos space list
takos repo create --body '{"name":"my-repo"}'
takos deploy https://github.com/acme/my-app.git --space SPACE_ID --group my-app
takos install acme/my-app --space SPACE_ID --group my-app
takos run follow RUN_ID --transport ws
```

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

## deploy CLI

`takos deploy` は Takos の current preferred deploy entrypoint です。positional
argument を 省略するとローカルの `.takos/app.yml` または `.takos/app.yaml` を
source にし、repository URL を渡すと その repo を source
にします。`takos install owner/repo --version TAG --group GROUP` は catalog
(Store) の owner/repo + version/tag を repository URL + Git tag
に解決し、`source.kind = "git_ref"` / `ref_type = "tag"` として同じ pipeline
を呼び出します。CLI は repo を clone せず、control plane が repo を fetch して
manifest を parse します（thin client）。

`takos rollback GROUP_NAME --space SPACE_ID` は保存済み snapshot を既存 group
に再適用する操作 です。group row が既に削除されている場合は失敗し、deleted group
を再生成しません。

```bash
takos deploy --space SPACE_ID --group my-app                                                   # local manifest
takos deploy --env staging --space SPACE_ID --group my-app                                     # local manifest with env
takos deploy https://github.com/acme/my-app.git --ref main --space SPACE_ID --group my-app     # repo URL
takos deploy --plan --space SPACE_ID --group my-app                                            # dry-run preview
takos deploy status --space SPACE_ID
takos deploy status GROUP_DEPLOYMENT_SNAPSHOT_ID --space SPACE_ID
takos rollback GROUP_NAME --space SPACE_ID
takos install OWNER/REPO --space SPACE_ID --version v1.0.0 --group my-app
takos uninstall GROUP_NAME --space SPACE_ID
```

| flag                       | required         | 役割                                                                     |
| -------------------------- | ---------------- | ------------------------------------------------------------------------ |
| positional `repositoryUrl` | no               | canonical HTTPS git repository URL（省略時は local manifest）            |
| `--ref`                    | no               | branch / tag / commit（repo URL 指定時）                                 |
| `--ref-type`               | no               | `branch` / `tag` / `commit`（repo URL 指定時、CLI で choice validation） |
| `--manifest`               | no               | local manifest path（既定は `.takos/app.yml` / `.takos/app.yaml`）       |
| `--plan`                   | no               | dry-run preview                                                          |
| `--group`                  | deploy / install | primitive を所属させる group 名                                          |
| `--env`                    | no               | target env                                                               |
| `--space`                  | no               | target space ID                                                          |
| `--target`                 | no               | plan-only diff entry name filter                                         |
| `--auto-approve`           | no               | 確認プロンプトを省略                                                     |
| `--json`                   | no               | JSON 出力                                                                |

`takos deploy --plan --space SPACE_ID --group NAME` は manifest validation
と現在状態との差分確認を行います。preview は non-mutating で、group が未作成でも
DB row は作りません。

deploy surface の詳細な options と group 機能の扱いは
[CLI command reference](/reference/cli) を参照してください。

## 次に読むページ

- [CLI command reference](/reference/cli)
- [Deploy System](/deploy/)
- [OAuth](/apps/oauth)
