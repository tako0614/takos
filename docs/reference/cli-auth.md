# CLI 認証

> このページでわかること: Takos CLI の認証方法とトークン管理。

Takos CLI は bearer token を使って API にアクセスします。
トークンは Takosumi Accounts の PAT または OIDC フローで取得します。

## login

```bash
takos login --api-url https://takos.example.com --token takpat_...
takos whoami
```

`takos login --token` は token と endpoint を `~/.takos/config.json` に保存します。
session bearer から PAT を作る場合は、Takosumi Accounts の account token API を
使います。

## 認証情報の解決順序

1. 環境変数
2. カレントディレクトリから親方向に探索する `.takos-session`
3. `~/.takos/config.json`

### 環境変数

| 環境変数 | 用途 |
| --- | --- |
| `TAKOS_SESSION_ID` | セッション ID による認証 |
| `TAKOS_TOKEN` | bearer token による認証 |
| `TAKOS_SPACE_ID` | default space |
| `TAKOS_API_URL` | API endpoint |
| `TAKOS_CONFIG_DIR` | local config dir |
| `TAKOS_TIMEOUT_MS` | CLI timeout |
| `TAKOS_API_TIMEOUT_MS` | API request timeout |

`TAKOS_SESSION_ID` がある場合は `TAKOS_TOKEN` より優先されます。

### `.takos-session`

`.takos-session` は session workdir のための file-based mode です。CLI は現在地
から親方向へ探索し、見つかった session / space / api_url を使います。

### local config

環境変数と `.takos-session` が無い場合、CLI は `~/.takos/config.json` を参照します。
`takos login` と `takos endpoint use` はこのファイルを更新します。

## endpoint

```bash
takos endpoint use production
takos endpoint use staging
takos endpoint use local
takos endpoint use https://custom.example.com
takos endpoint show
```

| preset | URL |
| --- | --- |
| `production` / `prod` | `https://takos.jp` |
| `staging` / `test` | `https://test.takos.jp` |
| `local` | `http://localhost:8787` |

## 次に読むページ

- [CLI command reference](/reference/cli)
- [OIDC Consumer](/apps/oidc-consumer)
- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
