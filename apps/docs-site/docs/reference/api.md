# API リファレンス

<!-- docs:api-families seed-repositories,explore,profiles,public-share,mcp,setup,me,spaces,shortcuts,services,custom-domains,resources,apps,threads,runs,search,index,memories,skills,sessions,git,repos,agent-tasks,notifications,pull-requests,app-deployments,browser-sessions,billing,auth,oauth -->

::: tip Coverage
このページは **route family 単位の current contract** をまとめています。Takos の public API は `/api/*` 配下で提供され、CLI の task domain もこの family 群にマップされます。
:::

## このリファレンスで依存してよい範囲

- `/api/*` の family ごとの責務
- auth mode と representative path
- current API surface の読み分け

## このリファレンスで依存してはいけない範囲

- family 名だけを見て lower-level internal route まで current contract だと解釈すること
- architecture や実装コードにある補助 route を、このページの代わりに採用判断へ使うこと
- request / response の完全 wire schema がここに全部書かれていると期待すること

## API の読み方

Takos API は、1 endpoint ずつの一覧よりも family 単位の責務で読む方が迷いません。
まず family を決め、次に auth mode と representative path を見ます。

## 認証

| mode | 使い方 | 用途 |
| --- | --- | --- |
| Session cookie | browser から `Cookie` | SPA / console |
| PAT | `Authorization: Bearer tak_pat_...` | CLI / automation |
| OAuth bearer | `Authorization: Bearer tak_oat_...` | third-party apps |
| Internal binding | service binding + internal headers | worker 間通信 |

PAT は `/api/me/personal-access-tokens` で管理します。

認証ヘッダーの形式:

```
Authorization: Bearer <access_token>
```

`<access_token>` には PAT（`tak_pat_...`）か OAuth トークン（`tak_oat_...`）を指定する。

## エラーレスポンスの共通形式

すべての API エンドポイントは、エラー発生時に以下の共通形式で返す:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Resource not found"
  }
}
```

主要なエラーコード:

| code | HTTP status | 意味 |
| --- | --- | --- |
| `BAD_REQUEST` | 400 | リクエストが不正 |
| `UNAUTHORIZED` | 401 | 認証が必要 |
| `FORBIDDEN` | 403 | 権限が不足 |
| `NOT_FOUND` | 404 | リソースが見つからない |
| `CONFLICT` | 409 | 競合が発生 |
| `RATE_LIMITED` | 429 | レート制限に到達 |
| `INTERNAL_ERROR` | 500 | サーバー内部エラー |

## Route families

### Public / optional auth

| family | auth | representative paths | purpose |
| --- | --- | --- | --- |
| `seed-repositories` | none | `/api/seed-repositories` | 初回導入用 seed repo 一覧 |
| `explore` | optional | `/api/explore/repos`, `/api/explore/catalog`, `/api/explore/users` | 公開 catalog / discover |
| `profiles` | optional | `/api/users/:username`, `/api/users/:username/repos` | 公開 profile / repo view |
| `public-share` | mixed | `/api/public/thread-shares/:token` | thread share の read / access grant |
| `mcp` | mixed | `/api/mcp/oauth/callback`, `/api/mcp/servers` | MCP OAuth callback と MCP server 管理 |
| `billing` | mixed | `/api/billing/webhook` | Stripe webhook |
| `oauth` | session | `/api/oauth/authorize/context`, `/api/oauth/device/context` | consent UI 用 API |

### Authenticated families

| family | representative paths | purpose |
| --- | --- | --- |
| `setup` | `/api/setup/status`, `/api/setup/complete` | 初期セットアップ状態 |
| `me` | `/api/me`, `/api/me/settings`, `/api/me/oauth/*`, `/api/me/personal-access-tokens` | current user / settings / PAT / OAuth client |
| `spaces` | `/api/spaces`, `/api/spaces/:spaceId`, `/api/spaces/:spaceId/members` | workspace/space 基本 CRUD |
| `spaces.storage` | `/api/spaces/:spaceId/storage/*` | file upload/download/list/bulk ops/file handlers |
| `spaces.common-env` | `/api/spaces/:spaceId/common-env` | 共通 env の read/write/delete |
| `spaces.stores` | `/api/spaces/:spaceId/stores`, `/api/spaces/:spaceId/store-registry/*` | store / registry / install flows |
| `shortcuts` | `/api/shortcuts`, `/api/spaces/:spaceId/shortcuts/groups` | shortcut と group 管理 |
| `services` | `/api/services`, `/api/services/:id` | service CRUD と runtime 管理 |
| `custom-domains` | `/api/services/:id/custom-domains/*` | custom domain verify / SSL refresh |
| `resources` | `/api/resources`, `/api/resources/:id/*` | resource CRUD / access / tokens / D1 / R2 |
| `apps` | `/api/apps`, `/api/apps/:id`, `/api/apps/:id/client-key` | builtin/custom app listing |
| `threads` | `/api/spaces/:spaceId/threads`, `/api/threads/:id/messages`, `/api/threads/:id/share` | thread / message / share |
| `runs` | `/api/threads/:threadId/runs`, `/api/runs/:id`, `/api/runs/:id/sse`, `/api/runs/:id/ws` | run 実行・event stream・artifact |
| `search` | `/api/spaces/:spaceId/search`, `/api/spaces/:spaceId/search/quick` | semantic / quick search |
| `index` | `/api/spaces/:spaceId/index`, `/api/spaces/:spaceId/graph` | indexing / graph 系 |
| `memories` | `/api/spaces/:spaceId/memories`, `/api/spaces/:spaceId/reminders` | memory / reminder |
| `skills` | `/api/spaces/:spaceId/skills`, `/api/workspaces/:workspaceId/skills` | skill catalog / custom skill |
| `sessions` | `/api/sessions/:sessionId/*` | session health / resume / discard / heartbeat |
| `git` | `/api/spaces/:spaceId/git/*` | space-scoped git 操作 |
| `repos` | `/api/spaces/:spaceId/repos`, `/api/repos/:repoId/*` | repo CRUD / tree/blob/commits/branches/releases/actions |
| `pull-requests` | `/api/repos/:repoId/pulls/*` | PR / review 系 |
| `agent-tasks` | `/api/spaces/:spaceId/agent-tasks`, `/api/agent-tasks/:id/plan` | task orchestration |
| `notifications` | `/api/notifications`, `/api/notifications/sse`, `/api/notifications/ws` | notification list / SSE / WS |
| `app-deployments` | `/api/spaces/:spaceId/app-deployments`, `/rollback`, `/rollout/*` | app deploy / rollback / rollout control |
| `browser-sessions` | `/api/spaces/:spaceId/browser-sessions`, `/api/browser-sessions/:id/*` | browser session lifecycle |
| `billing` | `/api/billing`, `/api/billing/usage`, `/api/billing/subscribe`, `/api/billing/invoices/*` | current account billing |
| `auth` | `/api/auth/me`, `/api/auth/profile`, `/api/auth/logout` | authenticated auth/profile actions |

## Representative operation models

### `seed-repositories`

初回導入時に表示される seed リポジトリの一覧を返す。認証不要。

```bash
GET /api/seed-repositories
```

レスポンス:

```json
{
  "repositories": [
    {
      "url": "https://github.com/example/repo.git",
      "name": "Example Repo",
      "description": "A sample repository",
      "category": "tool",
      "checked": true
    }
  ]
}
```

### `spaces`

`spaces` family は workspace/space を起点にした surface です。
基本 CRUD だけでなく、次の subresource を current contract に含みます。

- members
- repos bootstrap
- storage
- common env
- stores
- store registry

#### ワークスペース一覧

```bash
GET /api/spaces
Authorization: Bearer $TOKEN
```

レスポンス:

```json
{
  "spaces": [
    {
      "id": "ws_abc123",
      "name": "My Workspace",
      "slug": "my-workspace",
      "kind": "user",
      "role": "owner"
    }
  ]
}
```

#### ワークスペース作成

```bash
POST /api/spaces
Authorization: Bearer $TOKEN
Content-Type: application/json
```

リクエスト:

```json
{
  "name": "New Workspace"
}
```

レスポンス (201):

```json
{
  "space": {
    "id": "ws_def456",
    "name": "New Workspace",
    "slug": "new-workspace",
    "kind": "team"
  },
  "repository": {
    "id": "repo_xyz789",
    "name": "default"
  }
}
```

### `me`

現在のユーザー情報を取得・更新する。

#### ユーザー情報取得

```bash
GET /api/me
Authorization: Bearer $TOKEN
```

レスポンス:

```json
{
  "email": "user@example.com",
  "name": "Tako",
  "username": "tako",
  "picture": "https://example.com/avatar.png",
  "setup_completed": true
}
```

### `threads`

スレッド / メッセージの CRUD と共有。

#### スレッド一覧

```bash
GET /api/spaces/:spaceId/threads
Authorization: Bearer $TOKEN
```

レスポンス:

```json
{
  "threads": [
    {
      "id": "thread_abc",
      "title": "Debug session",
      "created_at": "2026-01-15T10:00:00Z",
      "updated_at": "2026-01-15T12:30:00Z"
    }
  ]
}
```

#### スレッド作成

```bash
POST /api/spaces/:spaceId/threads
Authorization: Bearer $TOKEN
Content-Type: application/json
```

リクエスト:

```json
{
  "title": "debug"
}
```

レスポンス (201):

```json
{
  "thread": {
    "id": "thread_new123",
    "title": "debug",
    "created_at": "2026-03-27T10:00:00Z"
  }
}
```

#### メッセージ一覧

```bash
GET /api/threads/:id/messages
Authorization: Bearer $TOKEN
```

レスポンス:

```json
{
  "messages": [
    {
      "id": "msg_001",
      "role": "user",
      "content": "Hello",
      "created_at": "2026-01-15T10:00:00Z"
    },
    {
      "id": "msg_002",
      "role": "assistant",
      "content": "Hi there!",
      "created_at": "2026-01-15T10:00:01Z"
    }
  ]
}
```

### `runs`

`runs` family は request/response だけでなく stream surface も持ちます。
状態変化を追うときは `/api/runs/:id/sse` または `/api/runs/:id/ws` を使います。

#### Run 詳細取得

```bash
GET /api/runs/:id
Authorization: Bearer $TOKEN
```

レスポンス:

```json
{
  "run": {
    "id": "run_abc123",
    "thread_id": "thread_abc",
    "status": "completed",
    "created_at": "2026-01-15T10:00:00Z",
    "completed_at": "2026-01-15T10:01:30Z"
  }
}
```

#### Run イベントを SSE で取得

```bash
GET /api/runs/:id/sse
Authorization: Bearer $TOKEN
```

Server-Sent Events 形式で Run の状態変化・ログをストリーミングで受信する。

#### Run キャンセル

```bash
POST /api/runs/:id/cancel
Authorization: Bearer $TOKEN
```

### `services`

`services` family は service/runtime surface の current public route family です。
codebase や UI に `worker` という語が残る場面がありますが、API path の正本は `/api/services` として読みます。

#### サービス一覧

```bash
GET /api/services
Authorization: Bearer $TOKEN
```

レスポンス:

```json
{
  "services": [
    {
      "id": "svc_abc123",
      "name": "my-api",
      "status": "active"
    }
  ]
}
```

### `repos`

`repos` family は repo CRUD に加えて、tree/blob/history、releases、actions、pull requests への入口でもあります。
Takos CLI で `repo` domain が広い責務を持つのはこのためです。

#### リポジトリ一覧

```bash
GET /api/spaces/:spaceId/repos
Authorization: Bearer $TOKEN
```

レスポンス:

```json
{
  "repositories": [
    {
      "id": "repo_abc123",
      "name": "my-app",
      "default_branch": "main"
    }
  ]
}
```

### `search`

#### セマンティック検索

```bash
POST /api/spaces/:spaceId/search
Authorization: Bearer $TOKEN
Content-Type: application/json
```

リクエスト:

```json
{
  "query": "how to deploy",
  "limit": 10
}
```

### `notifications`

#### 通知一覧

```bash
GET /api/notifications
Authorization: Bearer $TOKEN
```

レスポンス:

```json
{
  "notifications": [
    {
      "id": "notif_abc123",
      "type": "run_completed",
      "read": false,
      "created_at": "2026-01-15T10:00:00Z"
    }
  ]
}
```

#### SSE で通知をストリーミング受信

```bash
GET /api/notifications/sse
Authorization: Bearer $TOKEN
```

### `app-deployments`

`app-deployments` family は repo-local app deploy の public contract ですが、このリポジトリの current implementation では end-to-end に接続されていません。
主説明面は `services/:id/deployments` ではなく `/api/spaces/:spaceId/app-deployments` という設計メモとして残っています。

::: warning current implementation
現行の control-plane 実装では `AppDeploymentService` が legacy pipeline から切り離されており、`takos deploy` と app-deployments の実行経路は未接続です。実運用では `takos deploy-group` を使ってください。
:::

主要 endpoint:

- `POST /api/spaces/:spaceId/app-deployments`
- `GET /api/spaces/:spaceId/app-deployments`
- `GET /api/spaces/:spaceId/app-deployments/:appDeploymentId`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback`
- `GET /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/pause`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/resume`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/abort`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/promote`

#### デプロイ開始

```bash
POST /api/spaces/:spaceId/app-deployments
Authorization: Bearer $TOKEN
Content-Type: application/json
```

リクエスト:

```json
{
  "repo_id": "repo_abc123",
  "ref": "main",
  "ref_type": "branch"
}
```

レスポンス (201):

```json
{
  "success": true,
  "data": {
    "app_deployment_id": "adep_xyz789",
    "app_id": "app_def456",
    "name": "my-app",
    "version": "1.0.0",
    "source": {
      "repo_id": "repo_abc123",
      "ref": "main",
      "ref_type": "branch",
      "commit_sha": "abc123def456"
    }
  }
}
```

#### ロールバック

```bash
POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback
Authorization: Bearer $TOKEN
```

### `billing`

#### 利用状況

```bash
GET /api/billing/usage
Authorization: Bearer $TOKEN
```

#### Stripe Webhook

```bash
POST /api/billing/webhook
Stripe-Signature: t=...,v1=...
```

Stripe の署名検証を使用。セッション認証は不要。

### `auth`

#### ログイン中のユーザー情報

```bash
GET /api/auth/me
Authorization: Bearer $TOKEN
```

#### ログアウト

```bash
POST /api/auth/logout
Authorization: Bearer $TOKEN
```

## implementation note

deploy family は current public surface ですが、today の implementation gap は [Deploy System](/deploy/) に従って読みます。
このリファレンスは route family の存在と役割を示すものであり、end-to-end availability の保証は implementation note を優先してください。

## Examples

### current user を取得

```bash
curl -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/me
```

### thread を作成

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"title":"debug"}' \
  https://your-takos.example/api/spaces/ws_123/threads
```

### app deploy を開始

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"repo_id":"repo_123","ref":"main","ref_type":"branch"}' \
  https://your-takos.example/api/spaces/ws_123/app-deployments
```

### run event を SSE で追う

```bash
curl -N \
  -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/runs/run_123/sse
```

### seed repositories を取得

```bash
curl https://your-takos.example/api/seed-repositories
```

### workspace 一覧を取得

```bash
curl -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/spaces
```

### 通知を SSE でストリーミング受信

```bash
curl -N \
  -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/notifications/sse
```

## 次に読むページ

- [Deploy System](/deploy/)
- [CLI command reference](/reference/cli)
- [用語集](/reference/glossary)
