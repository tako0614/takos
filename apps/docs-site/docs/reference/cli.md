# CLI Commands

<!-- docs:cli-top-level login,whoami,logout,deploy,endpoint -->
<!-- docs:cli-domains me,setup,workspace,project,thread,run,artifact,task,repo,worker,app,resource,git,capability,context,shortcut,notification,public-share,auth,discover -->

## はじめに

Takos CLI は `takos <command>` で操作します。

```bash
takos login              # ログイン
takos --help             # ヘルプ
```

すべての操作は `takos <domain> <task>` の形式で統一されています。
domain は対象リソース、task は操作意図を表します。

---

## はじめての人向け

### 1. ログイン

```bash
takos login
# → ブラウザが開く → 承認 → 完了
```

ログインできたか確認するには:

```bash
takos whoami
```

### 2. 接続先を確認・切り替え

```bash
takos endpoint show              # 現在の接続先を表示
takos endpoint use prod          # production に切り替え
takos endpoint use test          # test に切り替え
```

### 3. Workspace を確認

```bash
takos workspace list
```

### 4. リポジトリを確認

```bash
takos repo list
```

ここまでできれば準備完了です。

---

## やりたいこと別ガイド

### アプリをデプロイしたい

#### Store 経由（CI/CD 向け）

リポジトリと ref を指定して、Store に登録済みの workflow artifact からデプロイします。

```bash
takos deploy --space SPACE_ID --repo REPO_ID --ref main
```

デプロイ前に設定を検証:

```bash
takos deploy validate
```

デプロイ状態を確認:

```bash
takos deploy status --space SPACE_ID
takos deploy status APP_DEPLOYMENT_ID --space SPACE_ID
```

問題があればロールバック:

```bash
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

#### ローカルから直接（開発向け）

`.takos/app.yml` で定義されたアプリグループを Cloudflare に直接デプロイします。

```bash
takos deploy-group --env staging \
  --account-id $CF_ACCOUNT_ID \
  --api-token $CF_API_TOKEN
```

#### deploy と deploy-group の使い分け

| 観点 | `deploy` | `deploy-group` |
|---|---|---|
| 用途 | Store 経由の正式デプロイ | ローカルから直接デプロイ |
| 対象 | repo/ref に紐づく artifact | `.takos/app.yml` のグループ定義 |
| 認証 | Takos の認証 | Cloudflare API トークン |
| 主な利用場面 | CI/CD パイプライン | 開発・検証環境 |

#### 特定サービスだけデプロイしたい

```bash
# 特定の worker のみ
takos deploy-group --env staging --worker browser-host

# 特定の container のみ
takos deploy-group --env staging --container my-api

# dispatch namespace にデプロイ
takos deploy-group --env staging --namespace takos-staging-tenants
```

#### ドライラン（実際にはデプロイしない）

```bash
takos deploy-group --env staging --dry-run
```

#### wrangler.toml を直接デプロイしたい

`app.yml` なしで、wrangler.toml から直接デプロイできます。

```bash
takos deploy-group --env staging --wrangler-config wrangler.worker.toml
```

---

### Agent を実行したい

#### スレッドを作成してメッセージを送る

```bash
takos thread create /spaces/SPACE_ID/threads --body '{"title":"debug"}'
```

#### Run を開始する

```bash
takos run start --body '{"prompt":"..."}'
```

#### Run の進行をリアルタイムで追う

```bash
takos run follow RUN_ID --transport sse
```

---

### リソースを管理したい

#### Workspace を作成

```bash
takos workspace create --body '{"name":"my-workspace"}'
```

#### リソースの CRUD

```bash
takos resource list
takos resource view RESOURCE_ID
takos resource create --body '{"type":"d1","name":"my-db"}'
takos resource remove RESOURCE_ID
```

---

### スキルやツールを確認したい

```bash
takos capability list /spaces/SPACE_ID/skills
```

### メモリ・リマインダーを管理したい

```bash
takos context list /spaces/SPACE_ID/memories
```

### 通知をリアルタイムで受け取りたい

```bash
takos notification watch /sse --transport sse
```

### スレッドを外部に共有したい

```bash
takos public-share create --body '{"threadId":"THREAD_ID"}'
```

---

## `takos deploy-group` 完全リファレンス

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
| `--account-id <id>` | yes* | Cloudflare アカウント ID（環境変数 `CLOUDFLARE_ACCOUNT_ID` でも可） |
| `--api-token <token>` | yes* | Cloudflare API トークン（環境変数 `CLOUDFLARE_API_TOKEN` でも可） |
| `--compatibility-date <date>` | no | Worker の compatibility date（デフォルト: `2025-01-01`） |
| `--dry-run` | no | デプロイせずに内容を表示 |
| `--json` | no | JSON 形式で出力 |

\* 環境変数で指定する場合はフラグ不要。

### 処理フロー

1. リソースプロビジョニング（D1, R2, KV, secretRef）
2. Worker サービスをデプロイ（CF Containers 含む）
3. Container サービスをデプロイ（常設コンテナ）
4. Secrets を設定
5. テンプレート変数（`env.inject`）を解決して注入

---

## 共通 task verb

すべての domain は以下の task verb を共通で持ちます。

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

stream 系 domain は追加で `watch`・`follow` を持ちます。

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
| `me` | - | ログインユーザー情報・設定 |
| `setup` | - | 初期セットアップ |
| `workspace` | `ws` | Workspace（Space）管理 |
| `thread` | - | スレッド・メッセージ |
| `run` | - | Run 実行とストリーム |
| `artifact` | - | Artifact 操作 |
| `task` | - | Agent タスクオーケストレーション |
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

| domain | 説明 |
|---|---|
| `project` | 旧 `/api/projects` 対応。current API family の正本には含まない |
| `worker` | 旧 worker 名残。正本は `/api/services` |

---

## 廃止されたコマンド

以下は current CLI surface ではありません。

- `takos api ...`
- `takos build` / `takos publish` / `takos promote`
- `takos rollback`（top-level）
- `takos mcp` / `takos pat`
- `takos pr` / `takos actions`
- `takos memory` / `takos reminder`
- `takos skill` / `takos tool`
- `takos oauth`
- `takos search` / `takos install`
- `takos <domain> get/post/patch/delete/...`

旧コマンドと現在の対応:

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
