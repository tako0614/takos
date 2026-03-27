# API リファレンス

Takos はすべての操作を REST API で提供します。アクセストークンを使って外部からプログラマティックに操作できます。

## 認証

### Personal Access Token (PAT)

すべてのリクエストに `Authorization: Bearer <token>` ヘッダを付与します。

```bash
curl -H "Authorization: Bearer tak_pat_..." https://your-takos.example/api/me
```

#### トークンの作成

1. Web UI: 設定 → Personal Access Tokens → 新規作成
2. API:

```bash
curl -X POST https://your-takos.example/api/me/personal-access-tokens \
  -H "Authorization: Bearer <existing-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-token", "scopes": "*"}'
```

レスポンス:

```json
{
  "id": "tok_abc123",
  "name": "my-token",
  "token": "tak_pat_...",
  "tokenPrefix": "tak_pat_abcd",
  "scopes": "*",
  "expiresAt": null,
  "createdAt": "2026-03-25T00:00:00Z"
}
```

`token` フィールドは作成時にのみ表示されます。DB には SHA256 ハッシュのみ保存されるため、再取得はできません。

#### トークン形式

| field | description |
| --- | --- |
| prefix | `tak_pat_` |
| body | 32 バイトランダム (base64url) |
| scopes | JSON 配列 or `"*"` (全権限) |
| expiresAt | ISO8601 (null = 無期限) |

### その他の認証方式

| 方式 | ヘッダ | 用途 |
| --- | --- | --- |
| Session Cookie | `Cookie: session_id=...` | ブラウザ |
| PAT | `Authorization: Bearer tak_pat_...` | CLI / API クライアント |
| OAuth Bearer | `Authorization: Bearer eyJ...` (JWT) | サードパーティアプリ |
| Container Auth | `X-Takos-Session-Id` + `X-Takos-Internal: 1` | 内部ランタイム |

## エンドポイント一覧

Base URL: `https://your-takos.example/api`

### ユーザー

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/me` | required | 現在のユーザー情報 |
| GET | `/me/settings` | required | ユーザー設定 |
| PATCH | `/me/settings` | required | 設定更新 |
| PATCH | `/me/username` | required | ユーザー名変更 |
| GET | `/me/personal-access-tokens` | required | PAT 一覧 |
| POST | `/me/personal-access-tokens` | required | PAT 作成 |
| DELETE | `/me/personal-access-tokens/:id` | required | PAT 無効化 |

### ワークスペース

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/spaces` | required | ワークスペース一覧 |
| POST | `/spaces` | required | ワークスペース作成 |
| GET | `/spaces/me` | required | 個人ワークスペース |
| GET | `/spaces/:id` | required | ワークスペース詳細 |
| PATCH | `/spaces/:id` | required | ワークスペース更新 |
| DELETE | `/spaces/:id` | required | ワークスペース削除 |
| GET | `/spaces/:id/members` | required | メンバー一覧 |
| POST | `/spaces/:id/members` | required | メンバー追加 |
| PATCH | `/spaces/:id/members/:memberId` | required | メンバーロール変更 |
| DELETE | `/spaces/:id/members/:memberId` | required | メンバー削除 |

### リポジトリ

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/repos` | optional | リポジトリ一覧 |
| POST | `/repos` | required | リポジトリ作成 |
| GET | `/repos/:id` | optional | リポジトリ詳細 |
| PATCH | `/repos/:id` | required | リポジトリ更新 |
| DELETE | `/repos/:id` | required | リポジトリ削除 |
| POST | `/repos/:id/star` | required | スター追加 |
| DELETE | `/repos/:id/star` | required | スター削除 |

### Git

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/git/repos/:id/commits` | optional | コミット一覧 |
| GET | `/git/repos/:id/branches` | optional | ブランチ一覧 |
| GET | `/git/repos/:id/objects/:sha` | optional | Git オブジェクト取得 |

### スレッド (会話)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/spaces/:spaceId/threads` | required | スレッド一覧 |
| POST | `/spaces/:spaceId/threads` | required | スレッド作成 |
| GET | `/threads/:id` | required | スレッド詳細 |
| POST | `/threads/:id/messages` | required | メッセージ送信 |
| PATCH | `/threads/:id` | required | スレッド更新 |
| DELETE | `/threads/:id` | required | スレッド削除 |
| GET | `/threads/:id/timeline` | required | タイムライン |

### Run (エージェント実行)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/threads/:threadId/runs` | required | Run 一覧 |
| POST | `/threads/:threadId/runs` | required | Run 開始 |
| GET | `/runs/:id` | required | Run 詳細・状態 |
| GET | `/runs/:id/timeline` | required | 実行タイムライン |
| PATCH | `/runs/:id` | required | Run 操作 (cancel 等) |

### アーティファクト

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/artifacts/:id` | required | アーティファクト取得 |
| POST | `/artifacts` | required | アーティファクト作成 |
| DELETE | `/artifacts/:id` | required | アーティファクト削除 |

### MCP サーバー

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/mcp/servers` | required | 登録済み MCP サーバー一覧 |
| POST | `/mcp/servers` | required | MCP サーバー登録 |
| GET | `/mcp/servers/:id` | required | MCP サーバー詳細 |
| PATCH | `/mcp/servers/:id` | required | MCP サーバー更新 (有効/無効) |
| DELETE | `/mcp/servers/:id` | required | MCP サーバー削除 |

### Store (ActivityPub)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/spaces/:id/stores` | required | ローカルストア一覧 |
| POST | `/spaces/:id/stores` | required | ストア作成 |
| GET | `/spaces/:id/store-registry` | required | リモートストア一覧 |
| POST | `/spaces/:id/store-registry` | required | リモートストア登録 |
| POST | `/spaces/:id/store-registry/:entryId/install` | required | リモートリポジトリインストール |

### スキル

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/skills` | required | 公式スキルカタログ |
| GET | `/workspaces/:id/skills` | required | ワークスペーススキル一覧 |
| POST | `/workspaces/:id/skills` | required | カスタムスキル作成 |
| PATCH | `/workspaces/:id/skills/:name` | required | スキル更新 |
| DELETE | `/workspaces/:id/skills/:name` | required | スキル削除 |

### Seed Repositories

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/seed-repositories` | none | 推奨パッケージ一覧 |

### 公開

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/explore/repos` | optional | 公開リポジトリ探索 |
| GET | `/explore/repos/trending` | optional | トレンド |
| GET | `/users/:username` | optional | ユーザープロフィール |

## レスポンス形式

### 成功

```json
{
  "id": "...",
  "name": "...",
  ...
}
```

### エラー

```json
{
  "error": "Not Found",
  "code": "NOT_FOUND",
  "message": "Resource not found"
}
```

| Status | Description |
| --- | --- |
| 401 | 認証なし / トークン無効 |
| 402 | 課金クォータ超過 |
| 403 | 権限不足 |
| 404 | リソースが存在しない |
| 409 | 競合 (重複等) |
| 500 | サーバーエラー |

## 使用例

### ワークスペースのスレッド一覧を取得

```bash
curl -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/spaces/ws_abc123/threads
```

### メッセージを送信してエージェントを実行

```bash
# 1. スレッド作成
THREAD=$(curl -s -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"title": "API test"}' \
  https://your-takos.example/api/spaces/ws_abc123/threads)

THREAD_ID=$(echo $THREAD | jq -r '.id')

# 2. メッセージ送信 + Run 開始
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"content": "What files are in this workspace?"}' \
  https://your-takos.example/api/threads/$THREAD_ID/messages
```

### MCP サーバーを登録

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"name": "my-tools", "url": "https://my-mcp-server.example/mcp"}' \
  https://your-takos.example/api/mcp/servers
```
