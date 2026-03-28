# CLI Commands

Takos CLI のコマンドリファレンス。`takos <command>` または `takos <domain> <task>` で操作する。

```bash
takos login              # ログイン
takos --help             # ヘルプ
```

---

## `takos deploy-group` 完全リファレンス

`.takos/app.yml` で定義されたアプリグループを Cloudflare に直接デプロイする。

```bash
takos deploy-group --env staging \
  --account-id $CF_ACCOUNT_ID \
  --api-token $CF_API_TOKEN
```

### オプション一覧

| オプション | 必須 | 説明 |
|---|---|---|
| `--env <name>` | yes | デプロイ先環境（staging, production） |
| `--manifest <path>` | no | マニフェストパス（デフォルト: `.takos/app.yml`） |
| `--worker <name...>` | no | 特定 worker のみデプロイ（複数指定可） |
| `--container <name...>` | no | 特定 container のみデプロイ（複数指定可） |
| `--namespace <name>` | no | dispatch namespace にデプロイ |
| `--group <name>` | no | グループ名（デフォルト: `metadata.name`） |
| `--wrangler-config <path>` | no | wrangler.toml を直接デプロイ（`--manifest`/`--worker`/`--container` と排他） |
| `--base-domain <domain>` | no | テンプレート変数のベースドメイン |
| `--account-id <id>` | yes* | Cloudflare アカウント ID（env: `CLOUDFLARE_ACCOUNT_ID`） |
| `--api-token <token>` | yes* | Cloudflare API トークン（env: `CLOUDFLARE_API_TOKEN`） |
| `--compatibility-date <date>` | no | Worker の compatibility date（デフォルト: `2025-01-01`） |
| `--dry-run` | no | デプロイせずに内容を表示 |
| `--json` | no | JSON 形式で出力 |

\* 環境変数で指定する場合はフラグ不要。

### 処理フロー

1. リソースプロビジョニング（D1, R2, KV, secretRef）
2. Worker サービスをデプロイ（CF Containers 含む）
3. Container サービスをデプロイ
4. Secrets を設定
5. テンプレート変数（`env.inject`）を解決して注入

---

## 共通 task verb

| verb | 操作 |
|---|---|
| `list` | 一覧取得 |
| `view` | 詳細表示 |
| `create` | 新規作成 |
| `replace` | 全体置換 |
| `update` | 部分更新 |
| `remove` | 削除 |
| `probe` | 存在確認 |
| `describe` | メタ情報 |

stream 系 domain は追加で `watch`・`follow` を持つ。

---

## 全コマンド一覧

### Top-level commands

| コマンド | 説明 |
|---|---|
| `takos login` | ログイン（ブラウザ OAuth） |
| `takos whoami` | ログイン中のユーザーを表示 |
| `takos logout` | ログアウト |
| `takos deploy` | Store 経由のアプリデプロイ |
| `takos deploy-group` | ローカルからの直接デプロイ |
| `takos endpoint` | 接続先の確認・切り替え |

### Task domains

| domain | aliases | 主な責務 |
|---|---|---|
| `me` | - | ログインユーザー情報 |
| `setup` | - | 初期セットアップ |
| `workspace` | `ws` | Workspace（Space）管理 |
| `thread` | - | スレッド・メッセージ |
| `run` | - | Run 実行とストリーム |
| `artifact` | - | Artifact 操作 |
| `task` | - | Agent タスク |
| `repo` | - | リポジトリ・PR・Actions |
| `app` | - | アプリ一覧・メタデータ |
| `resource` | - | リソース CRUD |
| `git` | - | Git 操作 |
| `capability` | `cap` | スキル・ツール |
| `context` | `ctx` | メモリ・リマインダー |
| `shortcut` | - | ショートカット管理 |
| `notification` | - | 通知の一覧・ストリーム |
| `public-share` | - | スレッドの外部共有 |
| `auth` | - | 認証・OAuth |
| `discover` | - | 検索・インストール |

### 互換性のために残っている domain

| domain | 現在の対応 |
|---|---|
| `project` | 旧 API 対応。current API family の正本には含まない |
| `worker` | 旧 worker 名残。正本は `/api/services` |

---

## 廃止されたコマンド

| 旧 | 現在 |
|---|---|
| `pr`, `actions` | `repo` |
| `memory`, `reminder` | `context` |
| `skill`, `tool` | `capability` |
| `oauth` | `auth` |
| `search`, `install` | `discover` |

---

## 次に読むページ

- [CLI / Auth model](/reference/cli-auth)
- [API リファレンス](/reference/api)
- [Deploy System](/deploy/)
