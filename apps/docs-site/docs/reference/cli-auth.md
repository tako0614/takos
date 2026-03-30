# CLI / Auth model

Takos CLI は task-oriented です。
HTTP verb をそのまま露出するのではなく、domain ごとの task を前面に出します。

## このページで依存してよい範囲

- `takos login` / `whoami` / `logout` の認証モデル
- CLI がどの順序で認証情報を解決するか
- `endpoint` / `deploy` / task domain の current surface

## このページで依存してはいけない範囲

- `takos api ...` のような legacy command
- HTTP verb style subcommand を current CLI とみなすこと
- OAuth Device Flow を CLI login の正本だと解釈すること

## implementation note

CLI の deploy surface は [Deploy System](/deploy/) の public contract に従います。
`takos deploy` は CLI に残っている contract ですが、このリポジトリの current implementation では end-to-end availability がありません。実運用の current surface は `takos apply` です。

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
[OAuth 仕様](/apps/oauth) で文書化されている Device Authorization Grant はサードパーティアプリ向けです。`takos login` はブラウザコールバック方式を使い、Device Flow は使いません。
:::

## 認証情報の解決順序

CLI は次の順序で認証情報を解決します。

1. 環境変数
2. カレントディレクトリから親方向に探索する `.takos-session`
3. `~/.takos/config.json`

### 環境変数モード

| 環境変数 | 用途 |
| --- | --- |
| `TAKOS_SESSION_ID` | セッション ID による認証 |
| `TAKOS_TOKEN` | bearer token による認証 |
| `TAKOS_WORKSPACE_ID` | デフォルト workspace の指定 |
| `TAKOS_API_URL` | API endpoint の上書き |

`TAKOS_SESSION_ID` がある場合は `TAKOS_TOKEN` より優先されます。

### session file mode

`.takos-session` は session workdir のための file-based mode です。
CLI は現在地から親方向へ探索し、見つかった場合はその session / workspace / api_url を使います。

### local config mode

環境変数と `.takos-session` が無い場合、CLI は `~/.takos/config.json` を参照します。
`takos login` や `takos endpoint use` が更新するのもこのローカル設定です。

## endpoint 切り替え

endpoint は preset 名またはカスタム URL で切り替えられます。

```bash
takos endpoint use prod
takos endpoint use staging
takos endpoint use local
takos endpoint use https://custom.example.com
takos endpoint show
```

| preset | URL |
| --- | --- |
| `prod` / `production` | `https://takos.jp` |
| `staging` / `test` | `https://test.takos.jp` |
| `local` | `http://localhost:8787` |

## task-oriented CLI

Takos CLI では、単純な HTTP verb 直叩きではなく `domain + task` を使います。

```bash
takos workspace list
takos repo create --body '{"name":"my-repo"}'
takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos run follow RUN_ID --transport ws
```

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

## deploy CLI

`takos deploy` は repo-local `.takos/app.yml` を前提に、`/api/spaces/:spaceId/app-deployments` を呼び出す contract です。現行実装ではこの経路は未接続です。

```bash
takos deploy --space SPACE_ID --repo REPO_ID --ref main
takos plan
takos deploy status --space SPACE_ID
takos deploy status APP_DEPLOYMENT_ID --space SPACE_ID
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

| flag | required | 役割 |
| --- | --- | --- |
| `--repo` | yes | repo ID |
| `--ref` | no | branch / tag / commit |
| `--ref-type` | no | `branch` / `tag` / `commit` |
| `--space` | no | target workspace ID |
| `--approve-oauth-auto-env` | no | OAuth auto env 差分の承認 |
| `--approve-source-change` | no | source provenance 差分の承認 |
| `--json` | no | JSON 出力 |

`takos plan` は manifest validation と現在状態との差分確認を行います。

## removed legacy surface

Takos CLI は次を current surface に含めません。

- `takos api ...`
- 直接的な HTTP verb style subcommands
- `takos build`
- `takos publish`
- `takos promote`

## 次に読むページ

- [CLI command reference](/reference/cli)
- [Deploy System](/deploy/)
- [OAuth](/apps/oauth)
