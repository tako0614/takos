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

CLI の deploy surface は [Deploy System](/deploy/) の compatibility contract
に従います。repo URL 経路では CLI は repository URL / ref を control plane
に渡す thin client です。local manifest flow では CLI が compiled Shape manifest
(`.takosumi/manifest.yml`、旧 `.takos/app.yml` / `.takos/app.yaml` は deprecated
alias、後方互換のため受理) を読み、`source.kind = "manifest"` payload
として送ります。build artifact collection / workflow execution / `workflowRef`
stripping は takosumi-git の責務です。runtime apply や rollback の business
logic は control plane に置きます。`repositoryUrl` と `--manifest` の 同時指定は
CLI で拒否します。

> 現行 API gateway split status は
> [API Gateway Split](/takosumi/current-state#api-gateway-split) を参照

## 認証

### `takos login`

Installable App Model では CLI の long-lived credential は **Takos PAT** か
Takosumi Accounts の device / OIDC flow で得た bearer token を使います。Takos
本体の legacy `/auth/cli` browser callback は retired route であり、新規
operator / client は依存しないでください。

`takos login --api-url <url>` は legacy 互換 command として残っていますが、
current Takos deployment では `/auth/cli` が `410 Gone` を返します。現行運用
では次のどちらかを使います。

1. Takos web UI で PAT を発行し、`TAKOS_TOKEN` と `TAKOS_API_URL` を設定する
2. Takosumi Accounts が提供する CLI/device flow で token を取得し、同じ
   bearer token として CLI に渡す

```bash
export TAKOS_API_URL=https://takos.example.com
export TAKOS_TOKEN=tak_pat_...
takos whoami
```

::: tip Device Flow の owner Device Authorization Grant は Takos 本体ではなく
Takosumi Accounts 側の OIDC issuer が提供します。Takos CLI は取得済み bearer
token を API request に載せる client です。 :::

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
deploy system は current Shape manifest と legacy compatibility records の
bridge として動きます。group は compatibility state scope で、deployment history
/ rollback などの group 機能を持ちます。CLI は `takos deploy` / `takos apply` /
`takos diff` / `takos approve` / `takos rollback` を 1st-class
でサポートします。個別操作のうち resource は `takos resource` / `takos res`
でも扱い、compute / route は control-plane HTTP API (`/api/services/*`)
を使います。MCP / file handler / launcher discovery は kernel manifest の
`publications[]` ではなく app metadata / registry の surface です。

```bash
takos space list
takos repo create --body '{"name":"my-repo"}'
takos deploy https://github.com/acme/my-app.git --space SPACE_ID
takos install acme/my-app --space SPACE_ID
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

`takos deploy` は Takos の compatibility deploy entrypoint です。positional
argument を省略するとローカルの `.takosumi/manifest.yml` (旧 `.takos/app.yml` /
`.takos/app.yaml` は deprecated alias、後方互換のため受理) を compiled manifest
source にし、repository URL を渡すとその repo を source に します。default の
`takos deploy <manifest>` は **resolve + apply** の sugar と して動き、1
回の呼び出しで Deployment 作成と GroupHead 進行まで実行します。

`takos install owner/repo --version TAG` は catalog item (Store) の owner/repo +
version/tag を repository URL + Git tag に解決し、 `source.kind = "git_ref"` /
`ref_type = "tag"` として同じ pipeline を呼び出 します。CLI は repo を clone
せず、control plane が repo を fetch して manifest を parse します（thin
client）。

`takos rollback [<group>] --space SPACE_ID` は GroupHead を
`previous_deployment_id`（または `--target-id` で指定した retained Deployment）
へ atomically swap する操作です。group row が既に削除されている場合は失敗し、
deleted group を再生成しません。

```bash
takos deploy --space SPACE_ID                                                   # local manifest, resolve+apply
takos deploy --env staging --space SPACE_ID                                     # local manifest with env
takos deploy https://github.com/acme/my-app.git --ref main --space SPACE_ID     # repo URL
takos deploy --preview --space SPACE_ID                                         # in-memory preview
takos deploy --resolve-only --space SPACE_ID                                    # persist resolved Deployment only
takos apply DEPLOYMENT_ID --space SPACE_ID                                      # apply a resolved Deployment
takos diff DEPLOYMENT_ID --space SPACE_ID                                       # show expansion + diff vs GroupHead
takos approve DEPLOYMENT_ID --space SPACE_ID                                    # attach approval (if required)
takos rollback [GROUP_NAME] --space SPACE_ID                                    # flip GroupHead to previous
takos install OWNER/REPO --space SPACE_ID --version v1.0.0
takos uninstall GROUP_NAME --space SPACE_ID
```

| flag                       | required         | 役割                                                                                                                                    |
| -------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| positional `repositoryUrl` | no               | canonical HTTPS git repository URL（省略時は local manifest）                                                                           |
| `--ref`                    | no               | branch / tag / commit（repo URL 指定時）                                                                                                |
| `--ref-type`               | no               | `branch` / `tag` / `commit`（repo URL 指定時、CLI で choice validation）                                                                |
| `--manifest`               | no               | local manifest path（既定は `.takosumi/manifest.yml`、旧 `.takos/app.yml` / `.takos/app.yaml` は deprecated alias、後方互換のため受理） |
| `--preview`                | no               | in-memory preview（Deployment record を作らない）                                                                                       |
| `--resolve-only`           | no               | resolved Deployment を作って apply は別途行う                                                                                           |
| `--group`                  | deploy / install | manifest の `name` 由来の group 名を override                                                                                           |
| `--env`                    | no               | target env                                                                                                                              |
| `--space`                  | no               | target space ID                                                                                                                         |
| `--auto-approve`           | no               | 確認プロンプトを省略                                                                                                                    |
| `--json`                   | no               | JSON 出力                                                                                                                               |

`takos deploy --preview --space SPACE_ID` は manifest validation と現在状態
との差分確認を行います。preview は non-mutating で、Deployment record も
作りません（`deployment_id` は `preview:<digest>` として返される）。

deploy surface の詳細な options と group 機能の扱いは
[CLI command reference](/reference/cli) を参照してください。

## 次に読むページ

- [CLI command reference](/reference/cli)
- [Deploy System](/deploy/)
- [OIDC Consumer](/apps/oidc-consumer)
