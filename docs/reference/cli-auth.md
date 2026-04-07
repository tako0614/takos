# CLI / Auth model

Takos CLI は task-oriented です。HTTP verb をそのまま露出するのではなく、domain
ごとの task を前面に出します。

## このページで依存してよい範囲

- `takos login` / `whoami` / `logout` の認証モデル
- CLI がどの順序で認証情報を解決するか
- `endpoint` / `deploy` / task domain の current surface

## このページで依存してはいけない範囲

- `takos api ...` や `takos apply` のような legacy command
- HTTP verb style subcommand を current CLI とみなすこと
- OAuth Device Flow を CLI login の正本だと解釈すること

## implementation note

CLI の deploy surface は [Deploy System](/deploy/) の public contract
に従います。CLI は source 解決や provider logic を持たない thin client
とし、deploy/install/rollback の business logic は control plane に置きます。

## 認証

### `takos login`

`takos login` はブラウザコールバック方式で認証します。

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
[OAuth の Device Authorization Grant](/apps/oauth#device-authorization-grant-device-flow) はサードパーティアプリが CLI / IoT クライアント向けに用意するフローです。`takos login` 自体はブラウザコールバック方式を使い、Device Flow は使いません。
:::

## 認証情報の解決順序

CLI は次の順序で認証情報を解決します。

1. 環境変数
2. カレントディレクトリから親方向に探索する `.takos-session`
3. `~/.takos/config.json`

### 環境変数モード

| 環境変数             | 用途                        |
| -------------------- | --------------------------- |
| `TAKOS_SESSION_ID`   | セッション ID による認証    |
| `TAKOS_TOKEN`        | bearer token による認証     |
| `TAKOS_WORKSPACE_ID` | デフォルト space の指定（env var 名は互換維持） |
| `TAKOS_API_URL`      | API endpoint の上書き       |

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
deploy system は **primitive (Layer 1) と group (Layer 2) の二層モデル** で、
CLI もそれに沿って primitive 個別操作 (`takos service`, `takos resource`) と
group bulk operation (`takos deploy`, `takos rollback`) の両方を 1st-class で
サポートします。

```bash
takos space list
takos repo create --body '{"name":"my-repo"}'
takos service list                                                   # Layer 1: primitive
takos resource create --body '{"name":"my-db","type":"sql"}'         # Layer 1: primitive
takos deploy https://github.com/acme/my-app.git --space SPACE_ID     # Layer 2: group bulk
takos install takos/takos-agent --space SPACE_ID                     # Layer 2: group bulk
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

`takos deploy` は Takos の唯一の deploy entrypoint です。positional argument を
省略するとローカルの `.takos/app.yml` を source にし、repository URL を渡すと
その repo を source にします。`takos install owner/repo@TAG` は
`takos deploy https://github.com/owner/repo.git --ref TAG` の sugar で、
catalog (Store) が owner/repo + version を repo URL に解決して同じ pipeline
を呼び出します。CLI は repo を clone せず、control plane が repo を fetch
して manifest を parse します（thin client）。

`takos rollback GROUP_NAME` は保存済み snapshot を既存 group に再適用する操作
です。group row が既に削除されている場合は失敗し、deleted group を再生成しません。

```bash
takos deploy                                                    # local manifest
takos deploy --env staging                                      # local manifest with env
takos deploy https://github.com/acme/my-app.git --ref main      # repo URL
takos deploy --plan                                             # dry-run preview
takos deploy status --space SPACE_ID
takos deploy status APP_DEPLOYMENT_ID --space SPACE_ID
takos rollback GROUP_NAME --space SPACE_ID
takos install OWNER/REPO --space SPACE_ID --version v1.0.0
takos uninstall GROUP_NAME --space SPACE_ID
```

| flag                       | required | 役割                                                  |
| -------------------------- | -------- | ----------------------------------------------------- |
| positional `repositoryUrl` | no       | canonical HTTPS git repository URL（省略時は local manifest） |
| `--ref`                    | no       | branch / tag / commit（repo URL 指定時）              |
| `--ref-type`               | no       | `branch` / `tag` / `commit`（repo URL 指定時）        |
| `--manifest`               | no       | local manifest path（既定は `.takos/app.yml`）        |
| `--env`                    | no       | target env                                            |
| `--space`                  | no       | target space ID                                       |
| `--json`                   | no       | JSON 出力                                             |

`takos deploy --plan` は manifest validation と現在状態との差分確認を行います。preview は
non-mutating で、group が未作成でも DB row は作りません。standalone の
`takos plan` コマンドはありません。

## removed legacy surface

Takos CLI は次を current surface に含めません。

- `takos apply`（`takos deploy` に統合）
- `takos api ...`
- 直接的な HTTP verb style subcommands
- `takos build`
- `takos publish`
- `takos promote`

## 次に読むページ

- [CLI command reference](/reference/cli)
- [Deploy System](/deploy/)
- [OAuth](/apps/oauth)
