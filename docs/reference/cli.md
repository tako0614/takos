# CLI

> このページでわかること: Takos CLI のコマンドと認証方法。

Takos CLI は Space やリポジトリの操作を行うクライアントです。
マニフェスト作成は `takosumi`、直接デプロイは `takosumi` CLI を使います。

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

## タスクドメイン

Takos CLI は HTTP メソッドをそのまま露出せず、ドメイン + タスクを前面に出します。

| ドメイン | 用途 |
| --- | --- |
| `me` | 現在のユーザー / アカウント情報 |
| `space` | space の一覧・作成・選択 |
| `thread` | thread 操作 |
| `run` | agent run の作成・追跡 |
| `task` | agent task の作成・状態確認 |
| `repo` | Takos Git リポジトリ操作 |
| `app` | インストール済みアプリの参照・起動 |
| `git` | Takos Git ヘルパー |
| `capability` / `cap` | space の capability 参照 |
| `context` / `ctx` | agent コンテキスト操作 |
| `shortcut` | ショートカット管理 |
| `notification` | 通知管理 |
| `public-share` | パブリックシェア管理 |
| `auth` | 認証ヘルパー |
| `discover` | discovery surface |

## 共通の verb

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

ストリーム対応のドメインは `watch` と `follow` を持ちます。

## サンプル

```bash
takos space list
takos repo create --body '{"name":"my-repo"}'
takos run follow RUN_ID --transport ws
takos app list --space SPACE_ID
takos notification list
```

## アプリインストール / デプロイ用の CLI

| 目的 | CLI |
| --- | --- |
| Git URL からアプリをインストールする | `takosumi install <git-url> --ref <tag>` |
| アプリを upgrade する | `takosumi deploy <installation-id> --source <git-url>#<tag>` |
| Deployment を rollback する | `takosumi rollback <installation-id> <deployment-id>` |

Takos CLI はアプリインストールや kernel apply パイプラインの実行主体ではなく、
Takos プロダクトの API を操作するクライアントとして使います。

## 次に読むページ

- [CLI 認証](/reference/cli-auth)
- [Git / Store install](/deploy/store-deploy)
- [Manifest を直接デプロイ](/deploy/deploy)
