# CLI

Takos CLI は Takos product の user / workspace task を扱う thin client です。
manifest authoring、workflow、Git URL install は `takosumi-git`、kernel direct
deploy は `takosumi` CLI を使います。

## 認証

```bash
takos login --api-url https://takos.example.com --token takpat_...
takos whoami
takos logout
```

認証情報は次の順に解決します。

1. `TAKOS_TOKEN` / `TAKOS_SESSION_ID`
2. カレントディレクトリから親方向にある `.takos-session`
3. `~/.takos/config.json`

endpoint は preset または URL で切り替えます。

```bash
takos endpoint use production
takos endpoint use staging
takos endpoint use local
takos endpoint use https://custom.example.com
takos endpoint show
```

## Task domains

Takos CLI は HTTP verb をそのまま露出せず、domain + task を前面に出します。

| domain | 用途 |
| --- | --- |
| `me` | 現在のユーザー / account 情報 |
| `space` | space の一覧・作成・選択 |
| `thread` | thread 操作 |
| `run` | agent run の作成・追跡 |
| `task` | agent task の作成・状態確認 |
| `repo` | Takos Git repository 操作 |
| `app` | installed app の参照・起動 |
| `git` | Takos Git helper |
| `capability` / `cap` | space capability の参照 |
| `context` / `ctx` | agent context 操作 |
| `shortcut` | shortcut 管理 |
| `notification` | notification 管理 |
| `public-share` | public share 管理 |
| `auth` | auth helper |
| `discover` | discovery surface |

## 共通 verbs

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

stream 対応 domain は `watch` と `follow` を持ちます。

## Examples

```bash
takos space list
takos repo create --body '{"name":"my-repo"}'
takos run follow RUN_ID --transport ws
takos app list --space SPACE_ID
takos notification list
```

## App install / deploy の CLI

| 目的 | CLI |
| --- | --- |
| Git URL から app を install する | `takosumi-git install <git-url> --ref <tag>` |
| app を upgrade する | `takosumi-git upgrade <installation-id> --ref <tag>` |
| compiled manifest を direct apply する | `takosumi deploy <manifest>` |

Takos CLI は app install pipeline や kernel apply pipeline の実行主体ではありません。
Takos product の API を操作する client として扱います。

## 次に読むページ

- [CLI / Auth model](/reference/cli-auth)
- [Git / Store install](/deploy/store-deploy)
- [Direct manifest deploy](/deploy/deploy)
