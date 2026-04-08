# API リファレンス

<!-- docs:api-families seed-repositories,explore,profiles,public-share,mcp,setup,me,spaces,shortcuts,services,custom-domains,resources,apps,threads,runs,search,index,memories,skills,sessions,git,repos,agent-tasks,notifications,pull-requests,app-deployments,browser-sessions,billing,auth,oauth,groups -->

::: tip Coverage このページは Takos の **public HTTP contract**
をまとめたリファレンスです。default distribution に含まれる kernel API と
first-party app API を含みます。implementation-only な互換 alias や内部 endpoint
は明示しない限りここでは扱いません。 :::

## 認証

| mode             | 使い方                              | 用途             |
| ---------------- | ----------------------------------- | ---------------- |
| Session cookie   | browser から `Cookie`               | SPA / console    |
| PAT              | `Authorization: Bearer tak_pat_...` | CLI / automation |
| OAuth bearer     | `Authorization: Bearer tak_oat_...` | third-party apps |
| Internal binding | service binding + internal headers  | worker 間通信    |

PAT は `/api/me/personal-access-tokens` で管理します。

認証ヘッダーの形式:

```
Authorization: Bearer <access_token>
```

`<access_token>` には PAT（`tak_pat_...`）か OAuth
トークン（`tak_oat_...`）を指定する。

::: tip Session cookie 仕様
- name: **`__Host-tp_session`** (`__Host-` prefix は Domain attribute を禁止し、Path=/ + Secure を強制する仕様)
- attributes: `Path=/`、`Secure`、`HttpOnly`、`SameSite=Strict`
- domain: なし (host-only cookie。subdomain には流れない)
- expiry: **7 日 fixed** (`Max-Age=604800`、自動延長なし。期限切れ時は再ログインが必要)
:::

::: tip App token 仕様
- 形式: JWT (RS256 署名、`/.well-known/jwks.json` で公開)
- claims: `iss="takos-kernel"` / `aud="takos-app"` / `sub="group:{groupName}"` / `scope` / `iat` / `exp`
- 有効期間: **24 時間** (deploy ごとに自動更新)
- 発行条件: `app.yml` の `scopes` 配列が宣言されているときのみ
:::

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

| code                     | HTTP status | 意味                                          |
| ------------------------ | ----------- | --------------------------------------------- |
| `BAD_REQUEST`            | 400         | リクエストが不正                              |
| `VALIDATION_ERROR`       | 400         | request body / params が schema に違反        |
| `UNAUTHORIZED`           | 401         | 認証が必要                                    |
| `FORBIDDEN`              | 403         | 権限が不足                                    |
| `NOT_FOUND`              | 404         | リソースが見つからない                        |
| `CONFLICT`               | 409         | 競合が発生                                    |
| `GONE`                   | 410         | リソースが期限切れ                            |
| `PAYMENT_REQUIRED`       | 402         | 課金 quota / plan 制限に到達                  |
| `PAYLOAD_TOO_LARGE`      | 413         | request body が max_size を超過               |
| `MISSING_CONTENT_TYPE`   | 415         | POST / PUT / PATCH で Content-Type header 無し |
| `UNSUPPORTED_CONTENT_TYPE` | 415       | Content-Type が allowlist 外                  |
| `RATE_LIMITED`           | 429         | レート制限に到達                              |
| `INTERNAL_ERROR`         | 500         | サーバー内部エラー                            |
| `NOT_IMPLEMENTED`        | 501         | 機能が未実装                                  |
| `BAD_GATEWAY`            | 502         | 上流サービスから不正な応答                    |
| `SERVICE_UNAVAILABLE`    | 503         | サービスが一時的に利用不可                    |
| `GATEWAY_TIMEOUT`        | 504         | 上流サービスがタイムアウト                    |

::: tip OAuth endpoints
`/oauth/*` endpoints は RFC 6749/6750 準拠の error format を使用 (`{ error: "invalid_token", error_description: "..." }`)。これは仕様上意図的に common envelope と異なります。
:::

## Rate limit

主要な敏感系 endpoint には sliding window の rate limit が適用される (1 分 window):

| カテゴリ | 上限 (req/min) | 適用対象 |
|---|---|---|
| `auth` | 100 | 認証エンドポイント (login / verify) |
| `sensitive` | 100 | bulk operations (storage bulk-delete / bulk-move / bulk-rename) |
| `oauth.token` | 20 | OAuth `/token` endpoint |
| `oauth.authorize` | 30 | OAuth `/authorize` endpoint |
| `oauth.revoke` | 10 | OAuth `/revoke` endpoint |
| `oauth.register` | 10 | Dynamic Client Registration |
| `oauth.deviceCode` | 10 | Device Authorization Grant `/device/code` |
| `oauth.deviceVerify` | 60 | Device verification UI |

レート制限到達時は HTTP `429` を返し、`error.code: "RATE_LIMITED"` + `error.details.retryAfter` (秒)。response header に `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` を付与する。

deploy 系 / billing meter 系の usage 制限は plan gate で別途 enforce される ([billing](/platform/billing) 参照)。

## Idempotency

長時間 / 副作用のある書き込み endpoint は `Idempotency-Key` header をサポート:

- `POST /api/services/:id/deployments`
- (将来追加予定の重要 mutation endpoint)

同じ `Idempotency-Key` で再 POST すると、サーバは初回の result を返す (実体は 1 度だけ実行)。

## ページネーション

多くのリスト系エンドポイントは `limit` / `offset` または `cursor`
ベースのページネーションをサポートする。

```
GET /api/resources?limit=20&offset=0
```

| param    | type   | description                                        |
| -------- | ------ | -------------------------------------------------- |
| `limit`  | number | 取得件数（デフォルトは endpoint 依存、最大値あり） |
| `offset` | number | スキップ件数（offset ベースの場合）                |
| `cursor` | string | 次ページのカーソル（cursor ベースの場合）          |

---

## Route families

### Public / optional auth

| family                                    | auth     | purpose                                     |
| ----------------------------------------- | -------- | ------------------------------------------- |
| [`seed-repositories`](#seed-repositories) | none     | space bootstrap 用 seed repo 一覧           |
| [`explore`](#explore)                     | optional | default catalog app の公開 discover surface |
| [`profiles`](#profiles)                   | optional | 公開 profile / repo view / follow / block   |
| [`public-share`](#public-share)           | mixed    | thread share の read / access grant         |
| [`mcp`](#mcp)                             | mixed    | MCP OAuth callback と MCP server 管理       |
| [`billing` (webhook)](#billing)           | none     | Stripe webhook                              |
| [`oauth` (consent)](#oauth-consent)       | session  | consent UI 用 API                           |

### Authenticated families

| family                                           | purpose                                                      |
| ------------------------------------------------ | ------------------------------------------------------------ |
| [`setup`](#setup)                                | 初期セットアップ状態                                         |
| [`me`](#me)                                      | current user / settings / PAT / OAuth client                 |
| [`spaces`](#spaces)                              | space 基本 CRUD / model / export                             |
| [`spaces.members`](#spacesmembers)               | space メンバー管理                                           |
| [`spaces.repositories`](#spacesrepositories)     | space 内 repo 初期化                                         |
| [`spaces.storage`](#spacesstorage)               | file upload/download/list/bulk ops                           |
| [`spaces.common-env`](#spacescommon-env)         | 共通 env の read/write/delete                                |
| [`spaces.stores`](#spacesstores)                 | first-party catalog app の ActivityPub store 管理            |
| [`spaces.store-registry`](#spacesstore-registry) | first-party catalog app の remote store registry / import    |
| [`shortcuts`](#shortcuts)                        | shortcut と group 管理                                       |
| [`services`](#services)                          | service CRUD / settings / deployments                        |
| [`custom-domains`](#custom-domains)              | custom domain verify / SSL refresh                           |
| [`resources`](#resources)                        | resource CRUD / access / tokens / D1 / R2                    |
| [`apps`](#apps)                                  | space-installed app inventory / install / launch             |
| [`threads`](#threads)                            | thread / message / share / export                            |
| [`runs`](#runs)                                  | run 実行・event stream・artifact                             |
| [`search`](#search)                              | semantic / quick search                                      |
| [`index`](#index)                                | indexing / vectorize / graph                                 |
| [`memories`](#memories)                          | memory CRUD / search                                         |
| [`reminders`](#reminders)                        | reminder CRUD / trigger                                      |
| [`skills`](#skills)                              | skill catalog / custom skill                                 |
| [`sessions`](#sessions)                          | session lifecycle / heartbeat                                |
| [`git`](#git)                                    | space-scoped git 操作                                        |
| [`repos`](#repos)                                | repo CRUD / tree / blob / branches / commits / stars / forks |
| [`repos.actions`](#reposactions)                 | workflow runs / secrets / artifacts                          |
| [`repos.releases`](#reposreleases)               | release CRUD                                                 |
| [`pull-requests`](#pull-requests)                | PR / review / merge                                          |
| [`agent-tasks`](#agent-tasks)                    | task orchestration                                           |
| [`notifications`](#notifications)                | notification list / SSE / WS                                 |
| [`app-deployments`](#app-deployments)            | app deploy / rollback                                        |
| [`browser-sessions`](#browser-sessions)          | browser session lifecycle                                    |
| [`groups`](#groups)                              | group 管理 / plan / apply                                    |
| [`billing`](#billing)                            | billing / usage / invoices                                   |
| [`auth`](#auth)                                  | authenticated auth/profile actions                           |

### Non-API routes

| family                                    | purpose                                  |
| ----------------------------------------- | ---------------------------------------- |
| [`smart-http`](#smart-http)               | Git Smart HTTP (clone / push)            |
| [`well-known`](#well-known)               | OAuth / OIDC discovery                   |
| [`activitypub-store`](#activitypub-store) | ActivityPub federation                   |
| [`oauth` (server)](#oauth-server)         | OAuth 2.0 token / authorize / introspect |

---

## seed-repositories

default distribution が space bootstrap のために返す seed
リポジトリ一覧。認証不要。

| method | path                     | description         |
| ------ | ------------------------ | ------------------- |
| GET    | `/api/seed-repositories` | seed リポジトリ一覧 |

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

---

## explore

default distribution に含まれる first-party catalog app の公開 discover
surface。認証はオプション。

### Repositories

| method | path                                             | description                          |
| ------ | ------------------------------------------------ | ------------------------------------ |
| GET    | `/api/explore/repos`                             | リポジトリ一覧（フィルタ・検索対応） |
| GET    | `/api/explore/repos/trending`                    | トレンドリポジトリ                   |
| GET    | `/api/explore/repos/new`                         | 新着リポジトリ                       |
| GET    | `/api/explore/repos/recent`                      | 最近更新されたリポジトリ             |
| GET    | `/api/explore/repos/by-name/:username/:repoName` | オーナー名+リポジトリ名で取得        |
| GET    | `/api/explore/repos/:id`                         | ID で取得                            |

### Catalog / Packages

| method | path                                                 | description                 |
| ------ | ---------------------------------------------------- | --------------------------- |
| GET    | `/api/explore/catalog`                               | カタログアイテム一覧        |
| GET    | `/api/explore/suggest`                               | 検索サジェスト              |
| GET    | `/api/explore/catalog/suggest`                       | カタログサジェスト          |
| GET    | `/api/explore/packages`                              | パッケージ検索              |
| GET    | `/api/explore/packages/suggest`                      | パッケージサジェスト        |
| GET    | `/api/explore/packages/:username/:repoName/latest`   | 最新バージョン              |
| GET    | `/api/explore/packages/:username/:repoName/versions` | 全バージョン一覧            |
| GET    | `/api/explore/packages/by-repo/:repoId/reviews`      | パッケージレビュー一覧      |
| POST   | `/api/explore/packages/by-repo/:repoId/reviews`      | レビュー投稿 _(deprecated)_ |

### Users

| method | path                           | description                       |
| ------ | ------------------------------ | --------------------------------- |
| GET    | `/api/explore/users`           | ユーザー一覧（検索対応）          |
| GET    | `/api/explore/users/:username` | ユーザープロファイル + リポジトリ |

---

## profiles

公開プロファイル閲覧・フォロー・ブロック・ミュート。認証はオプション（一部操作は認証必須）。

### Profile / Repos

| method | path                                         | description                |
| ------ | -------------------------------------------- | -------------------------- |
| GET    | `/api/users/:username`                       | ユーザープロファイル       |
| GET    | `/api/users/:username/repos`                 | ユーザーのリポジトリ一覧   |
| GET    | `/api/users/:username/stars`                 | ユーザーの star 一覧       |
| GET    | `/api/users/:username/activity`              | アクティビティフィード     |
| GET    | `/api/users/:username/:repoName`             | リポジトリ詳細（名前指定） |
| DELETE | `/api/users/:username/:repoName`             | リポジトリ削除（名前指定） |
| GET    | `/api/users/:username/:repoName/tree/:ref`   | ディレクトリツリー         |
| GET    | `/api/users/:username/:repoName/tree/:ref/*` | サブディレクトリツリー     |
| GET    | `/api/users/:username/:repoName/blob/:ref`   | ファイル内容               |
| GET    | `/api/users/:username/:repoName/blob/:ref/*` | ファイル内容（サブパス）   |
| GET    | `/api/users/:username/:repoName/branches`    | ブランチ一覧               |
| GET    | `/api/users/:username/:repoName/commits`     | コミット一覧               |

### Follow

| method | path                                              | description                     |
| ------ | ------------------------------------------------- | ------------------------------- |
| GET    | `/api/users/:username/followers`                  | フォロワー一覧                  |
| GET    | `/api/users/:username/following`                  | フォロー中一覧                  |
| GET    | `/api/users/:username/follow-requests`            | フォローリクエスト一覧 _(auth)_ |
| POST   | `/api/users/:username/follow-requests/:id/accept` | フォローリクエスト承認 _(auth)_ |
| POST   | `/api/users/:username/follow-requests/:id/reject` | フォローリクエスト拒否 _(auth)_ |
| POST   | `/api/users/:username/follow`                     | フォロー _(auth)_               |
| DELETE | `/api/users/:username/follow`                     | フォロー解除 _(auth)_           |

### Block / Mute

| method | path                         | description           |
| ------ | ---------------------------- | --------------------- |
| POST   | `/api/users/:username/block` | ブロック _(auth)_     |
| DELETE | `/api/users/:username/block` | ブロック解除 _(auth)_ |
| POST   | `/api/users/:username/mute`  | ミュート _(auth)_     |
| DELETE | `/api/users/:username/mute`  | ミュート解除 _(auth)_ |

---

## public-share

thread share の公開アクセス。認証不要（パスワード保護あり）。

| method | path                                      | description                  |
| ------ | ----------------------------------------- | ---------------------------- |
| GET    | `/api/public/thread-shares/:token`        | 共有スレッドデータ取得       |
| POST   | `/api/public/thread-shares/:token/access` | パスワード検証・アクセス取得 |

---

## mcp

MCP (Model Context Protocol) サーバー管理。

| method | path                         | auth     | description              |
| ------ | ---------------------------- | -------- | ------------------------ |
| GET    | `/api/mcp/oauth/callback`    | none     | OAuth コールバック       |
| GET    | `/api/mcp/servers`           | required | 登録 MCP サーバー一覧    |
| POST   | `/api/mcp/servers`           | required | MCP サーバー登録         |
| PATCH  | `/api/mcp/servers/:id`       | required | MCP サーバー更新         |
| DELETE | `/api/mcp/servers/:id`       | required | MCP サーバー削除         |
| GET    | `/api/mcp/servers/:id/tools` | required | MCP サーバーのツール一覧 |

---

## setup

初期セットアップ状態の確認・完了。

| method | path                        | description                       |
| ------ | --------------------------- | --------------------------------- |
| GET    | `/api/setup/status`         | セットアップ状態確認              |
| POST   | `/api/setup/complete`       | セットアップ完了（username 必須） |
| POST   | `/api/setup/check-username` | ユーザー名の利用可能性チェック    |

---

## me

現在の認証ユーザー情報の取得・更新。

### User info

| method | path                     | description            |
| ------ | ------------------------ | ---------------------- |
| GET    | `/api/me`                | ユーザー情報取得       |
| GET    | `/api/me/personal-space` | パーソナルスペース取得 |
| GET    | `/api/me/settings`       | ユーザー設定取得       |
| PATCH  | `/api/me/settings`       | ユーザー設定更新       |
| PATCH  | `/api/me/username`       | ユーザー名変更         |

#### `GET /api/me`

```json
{
  "email": "user@example.com",
  "name": "Tako",
  "username": "tako",
  "picture": "https://example.com/avatar.png",
  "setup_completed": true
}
```

#### `PATCH /api/me/settings`

リクエスト:

```json
{
  "setup_completed": true,
  "auto_update_enabled": true,
  "private_account": false,
  "activity_visibility": "public"
}
```

`activity_visibility` は `public` | `followers` | `private` のいずれか。

#### `PATCH /api/me/username`

リクエスト:

```json
{ "username": "new-name" }
```

### OAuth consents

| method | path                               | description        |
| ------ | ---------------------------------- | ------------------ |
| GET    | `/api/me/oauth/consents`           | 同意済みアプリ一覧 |
| DELETE | `/api/me/oauth/consents/:clientId` | 同意取り消し       |
| GET    | `/api/me/oauth/audit-logs`         | OAuth 操作ログ     |

### OAuth clients

| method | path                              | description          |
| ------ | --------------------------------- | -------------------- |
| GET    | `/api/me/oauth/clients`           | 所有クライアント一覧 |
| POST   | `/api/me/oauth/clients`           | クライアント作成     |
| PATCH  | `/api/me/oauth/clients/:clientId` | クライアント更新     |
| DELETE | `/api/me/oauth/clients/:clientId` | クライアント削除     |

#### `POST /api/me/oauth/clients`

リクエスト:

```json
{
  "client_name": "My App",
  "redirect_uris": ["https://example.com/callback"],
  "client_uri": "https://example.com",
  "logo_uri": "https://example.com/logo.png"
}
```

### Personal Access Tokens

| method | path                                 | description |
| ------ | ------------------------------------ | ----------- |
| GET    | `/api/me/personal-access-tokens`     | PAT 一覧    |
| POST   | `/api/me/personal-access-tokens`     | PAT 作成    |
| DELETE | `/api/me/personal-access-tokens/:id` | PAT 削除    |

#### `POST /api/me/personal-access-tokens`

リクエスト:

```json
{
  "name": "CLI token",
  "scopes": "*",
  "expiresAt": "2027-01-01T00:00:00Z"
}
```

レスポンス (201):

```json
{
  "id": "pat_abc123",
  "name": "CLI token",
  "token": "tak_pat_...",
  "token_prefix": "tak_pat_abcd",
  "scopes": "*",
  "expires_at": "2027-01-01T00:00:00Z",
  "created_at": "2026-03-29T10:00:00Z"
}
```

::: warning `token`
フィールドは作成時のレスポンスにのみ含まれる。再取得はできない。 :::

::: tip Scope wildcard
`scopes: "*"` を指定すると、issuance 時点の **全 scope** を expand して付与する。新しく追加された scope は自動 grant されない (再発行が必要)。
:::

---

## spaces

space の CRUD・モデル設定・エクスポート。

| method | path                                 | description                       |
| ------ | ------------------------------------ | --------------------------------- |
| GET    | `/api/spaces`                        | space 一覧                        |
| POST   | `/api/spaces`                        | space 作成                        |
| GET    | `/api/spaces/me`                     | パーソナル space 取得             |
| GET    | `/api/spaces/:spaceId`               | space 詳細                        |
| PATCH  | `/api/spaces/:spaceId`               | space 更新 _(owner/admin)_        |
| DELETE | `/api/spaces/:spaceId`               | space 削除 _(owner)_              |
| GET    | `/api/spaces/:spaceId/export`        | space エクスポート情報            |
| GET    | `/api/spaces/:spaceId/model`         | AI モデル設定取得                 |
| PATCH  | `/api/spaces/:spaceId/model`         | AI モデル設定更新 _(owner/admin)_ |
| GET    | `/api/spaces/:spaceId/sidebar-items` | サイドバーアイテム取得            |

#### `POST /api/spaces`

リクエスト:

```json
{ "name": "New Space" }
```

レスポンス (201):

```json
{
  "space": {
    "id": "ws_def456",
    "name": "New Space",
    "slug": "new-space",
    "kind": "team"
  },
  "repository": {
    "id": "repo_xyz789",
    "name": "default"
  }
}
```

#### `PATCH /api/spaces/:spaceId`

リクエスト:

```json
{
  "name": "Updated Name",
  "ai_model": "claude-sonnet-4-6",
  "ai_provider": "anthropic",
  "security_posture": "standard"
}
```

`security_posture` は `standard` | `restricted_egress` のいずれか。

#### `PATCH /api/spaces/:spaceId/model`

リクエスト:

```json
{
  "model": "claude-sonnet-4-6",
  "provider": "anthropic"
}
```

---

## spaces.members

ワークスペースメンバーの管理。

| method | path                                     | description                  |
| ------ | ---------------------------------------- | ---------------------------- |
| GET    | `/api/spaces/:spaceId/members`           | メンバー一覧                 |
| POST   | `/api/spaces/:spaceId/members`           | メンバー追加 _(owner/admin)_ |
| PATCH  | `/api/spaces/:spaceId/members/:username` | ロール変更 _(owner/admin)_   |
| DELETE | `/api/spaces/:spaceId/members/:username` | メンバー削除 _(owner/admin)_ |

#### `POST /api/spaces/:spaceId/members`

リクエスト:

```json
{ "email": "user@example.com", "role": "editor" }
```

ロール: `admin` | `editor` | `viewer`（`owner` は設定不可）

---

## spaces.repositories

ワークスペース内リポジトリの初期化。

| method | path                             | description                                |
| ------ | -------------------------------- | ------------------------------------------ |
| POST   | `/api/spaces/:spaceId/init-repo` | デフォルトリポジトリ初期化 _(owner/admin)_ |

---

## spaces.storage

ファイルストレージの操作。OAuth スコープ `files:read` / `files:write` に対応。

### ダウンロード

| method | path                                            | description                   |
| ------ | ----------------------------------------------- | ----------------------------- |
| GET    | `/api/spaces/:spaceId/storage/:fileId/content`  | ファイル内容取得              |
| PUT    | `/api/spaces/:spaceId/storage/:fileId/content`  | ファイル内容書き込み          |
| GET    | `/api/spaces/:spaceId/storage/download/:fileId` | ファイルダウンロード          |
| GET    | `/api/spaces/:spaceId/storage/download-url`     | ダウンロード URL 取得         |
| GET    | `/api/spaces/:spaceId/storage/download-zip`     | フォルダを ZIP でダウンロード |

### アップロード

| method | path                                          | description           |
| ------ | --------------------------------------------- | --------------------- |
| POST   | `/api/spaces/:spaceId/storage/files`          | ファイル作成          |
| POST   | `/api/spaces/:spaceId/storage/upload-url`     | アップロード URL 取得 |
| PUT    | `/api/spaces/:spaceId/storage/upload/:fileId` | ファイルアップロード  |
| POST   | `/api/spaces/:spaceId/storage/confirm-upload` | アップロード確認      |

### 管理

| method | path                                         | description            |
| ------ | -------------------------------------------- | ---------------------- |
| GET    | `/api/spaces/:spaceId/storage`               | ファイル一覧           |
| GET    | `/api/spaces/:spaceId/storage/file-handlers` | ファイルハンドラー取得 |
| POST   | `/api/spaces/:spaceId/storage/folders`       | フォルダ作成           |
| GET    | `/api/spaces/:spaceId/storage/:fileId`       | ファイル詳細           |
| PATCH  | `/api/spaces/:spaceId/storage/:fileId`       | リネーム / 移動        |
| DELETE | `/api/spaces/:spaceId/storage/:fileId`       | ファイル削除           |
| POST   | `/api/spaces/:spaceId/storage/bulk-delete`   | 一括削除               |
| POST   | `/api/spaces/:spaceId/storage/bulk-move`     | 一括移動               |
| POST   | `/api/spaces/:spaceId/storage/bulk-rename`   | 一括リネーム           |

::: tip MIME type detection
ファイル作成時の `mimeType` field は client が指定可能。未指定なら kernel が
**ファイル名拡張子から推定** する (`.md` → `text/markdown`、`.png` → `image/png` 等)。
推定失敗時は `application/octet-stream` を fallback として保存。
保存後の content sniffing は行われません (client が誤った MIME を渡せばそのまま記録される)。
:::

::: warning Move / rename atomicity
`PATCH /storage/:fileId` と `bulk-move` / `bulk-rename` は **per-file atomic** です:
- 各 file の rename / parent folder 変更は単一 DB transaction で実行
- ただし bulk operation 全体は **non-atomic**: 中間で失敗しても部分的な成功が残る
- 競合 (同名 destination 存在) は per-file で `CONFLICT (409)` を返し、残りの items は処理を継続
- response body に成功/失敗を per-item で含む
:::

---

## spaces.common-env

ワークスペース共通環境変数の管理。

| method | path                                    | description                          |
| ------ | --------------------------------------- | ------------------------------------ |
| GET    | `/api/spaces/:spaceId/common-env`       | 共通環境変数一覧                     |
| PUT    | `/api/spaces/:spaceId/common-env`       | 環境変数の作成・更新 _(owner/admin)_ |
| DELETE | `/api/spaces/:spaceId/common-env/:name` | 環境変数削除 _(owner/admin)_         |

#### `PUT /api/spaces/:spaceId/common-env`

リクエスト:

```json
{
  "name": "DATABASE_URL",
  "value": "postgres://...",
  "secret": true
}
```

---

## spaces.stores

default distribution に含まれる first-party catalog app が使う、space-scoped
ActivityPub store 管理 surface。kernel 自体の必須責務ではありません。

| method | path                                     | description                |
| ------ | ---------------------------------------- | -------------------------- |
| GET    | `/api/spaces/:spaceId/stores`            | ストア一覧                 |
| POST   | `/api/spaces/:spaceId/stores`            | ストア作成 _(owner/admin)_ |
| PATCH  | `/api/spaces/:spaceId/stores/:storeSlug` | ストア更新 _(owner/admin)_ |
| DELETE | `/api/spaces/:spaceId/stores/:storeSlug` | ストア削除 _(owner/admin)_ |

### Inventory

| method | path                                                       | description                         |
| ------ | ---------------------------------------------------------- | ----------------------------------- |
| GET    | `/api/spaces/:spaceId/stores/:storeSlug/inventory`         | store inventory 一覧                |
| POST   | `/api/spaces/:spaceId/stores/:storeSlug/inventory`         | inventory item 追加 _(owner/admin)_ |
| DELETE | `/api/spaces/:spaceId/stores/:storeSlug/inventory/:itemId` | inventory item 削除 _(owner/admin)_ |

### Grants

| method | path                                                 | description                     |
| ------ | ---------------------------------------------------- | ------------------------------- |
| GET    | `/api/spaces/:spaceId/repos/:repoId/grants`          | repo grants 一覧                |
| POST   | `/api/spaces/:spaceId/repos/:repoId/grants`          | repo grant 作成 _(owner/admin)_ |
| DELETE | `/api/spaces/:spaceId/repos/:repoId/grants/:grantId` | repo grant 削除 _(owner/admin)_ |

#### `POST /api/spaces/:spaceId/stores`

リクエスト:

```json
{
  "slug": "my-store",
  "name": "My Store",
  "summary": "Public package store",
  "icon_url": "https://example.com/icon.png"
}
```

---

## spaces.store-registry

default distribution に含まれる first-party catalog app が使う、remote catalog
registry と repository import の管理 surface。kernel
自体の必須責務ではありません。

| method | path                                                               | description                                             |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------- |
| GET    | `/api/spaces/:spaceId/store-registry`                              | 登録ストア一覧                                          |
| POST   | `/api/spaces/:spaceId/store-registry`                              | リモートストア追加 _(owner/admin)_                      |
| PATCH  | `/api/spaces/:spaceId/store-registry/:entryId`                     | ストア設定更新 _(owner/admin)_                          |
| DELETE | `/api/spaces/:spaceId/store-registry/:entryId`                     | リモートストア削除 _(owner/admin)_                      |
| POST   | `/api/spaces/:spaceId/store-registry/:entryId/refresh`             | メタデータ更新 _(owner/admin)_                          |
| GET    | `/api/spaces/:spaceId/store-registry/:entryId/repositories`        | リモートリポジトリ一覧                                  |
| GET    | `/api/spaces/:spaceId/store-registry/:entryId/repositories/search` | リモートリポジトリ検索                                  |
| POST   | `/api/spaces/:spaceId/store-registry/:entryId/import-repository`   | リモートストアから repository を import _(owner/admin)_ |
| GET    | `/api/spaces/:spaceId/store-registry/updates`                      | サブスクリプション更新確認                              |
| POST   | `/api/spaces/:spaceId/store-registry/updates/mark-seen`            | 更新を既読にする                                        |
| POST   | `/api/spaces/:spaceId/store-registry/:entryId/poll`                | 手動ポーリング _(owner/admin)_                          |

::: tip Subscription model
Store registry の subscription は **pull-based** です。
- リモートストア追加時 + `refresh` 呼び出し時に metadata を fetch (ActivityPub actor + outbox)
- 自動 polling は **行われません**。space owner が `/refresh` または `/poll` を叩くか、catalog app の cron で更新を取得する設計
- `updates` endpoint は last `mark-seen` 以降に追加された Add activity の差分を返す
- `import-repository` は inventory の repository entry を Local DB に複製 (mirror) する
:::

---

## shortcuts

ショートカットとショートカットグループの管理。

### Shortcuts

| method | path                     | description            |
| ------ | ------------------------ | ---------------------- |
| GET    | `/api/shortcuts`         | ショートカット一覧     |
| POST   | `/api/shortcuts`         | ショートカット作成     |
| PUT    | `/api/shortcuts/:id`     | ショートカット更新     |
| DELETE | `/api/shortcuts/:id`     | ショートカット削除     |
| POST   | `/api/shortcuts/reorder` | ショートカット並び替え |

### Shortcut groups

| method | path                                                           | description                         |
| ------ | -------------------------------------------------------------- | ----------------------------------- |
| GET    | `/api/spaces/:spaceId/shortcuts/groups`                        | グループ一覧                        |
| POST   | `/api/spaces/:spaceId/shortcuts/groups`                        | グループ作成 _(owner/admin/editor)_ |
| GET    | `/api/spaces/:spaceId/shortcuts/groups/:groupId`               | グループ詳細                        |
| PATCH  | `/api/spaces/:spaceId/shortcuts/groups/:groupId`               | グループ更新 _(owner/admin/editor)_ |
| DELETE | `/api/spaces/:spaceId/shortcuts/groups/:groupId`               | グループ削除 _(owner/admin)_        |
| POST   | `/api/spaces/:spaceId/shortcuts/groups/:groupId/items`         | アイテム追加 _(owner/admin/editor)_ |
| DELETE | `/api/spaces/:spaceId/shortcuts/groups/:groupId/items/:itemId` | アイテム削除 _(owner/admin/editor)_ |

---

## services

サービス（Workers）の CRUD・設定・デプロイ管理。

### 基本 CRUD

| method | path                           | description            |
| ------ | ------------------------------ | ---------------------- |
| GET    | `/api/services`                | サービス一覧           |
| GET    | `/api/services/space/:spaceId` | スペース内サービス一覧 |
| POST   | `/api/services`                | サービス作成           |
| GET    | `/api/services/:id`            | サービス詳細           |
| GET    | `/api/services/:id/logs`       | サービスログ取得       |
| PATCH  | `/api/services/:id/group`      | group への所属変更     |
| DELETE | `/api/services/:id`            | サービス削除           |

#### `GET /api/services`

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

### 設定

| method | path                         | description        |
| ------ | ---------------------------- | ------------------ |
| GET    | `/api/services/:id/settings` | ランタイム設定取得 |
| PATCH  | `/api/services/:id/settings` | ランタイム設定更新 |
| PATCH  | `/api/services/:id/slug`     | スラッグ変更       |

#### `PATCH /api/services/:id/settings`

設定項目: `compatibility_date`, `compatibility_flags`, `limits`, `mcp_server`

### 環境変数

| method | path                    | description          |
| ------ | ----------------------- | -------------------- |
| GET    | `/api/services/:id/env` | ローカル環境変数一覧 |
| PATCH  | `/api/services/:id/env` | ローカル環境変数更新 |

#### `PATCH /api/services/:id/env`

リクエスト:

```json
{
  "variables": [
    { "name": "API_KEY", "value": "secret", "secret": true },
    { "name": "NODE_ENV", "value": "production" }
  ]
}
```

### Common Env Links

| method | path                                 | description                      |
| ------ | ------------------------------------ | -------------------------------- |
| GET    | `/api/services/:id/common-env-links` | 共通環境変数リンク一覧           |
| PUT    | `/api/services/:id/common-env-links` | リンク全置換                     |
| PATCH  | `/api/services/:id/common-env-links` | リンク差分更新（add/remove/set） |

#### `PATCH /api/services/:id/common-env-links`

リクエスト:

```json
{
  "add": ["DATABASE_URL"],
  "remove": ["OLD_KEY"],
  "builtins": {
    "TAKOS_ACCESS_TOKEN": { "scopes": ["files:read"] }
  }
}
```

### Bindings

| method | path                         | description                |
| ------ | ---------------------------- | -------------------------- |
| GET    | `/api/services/:id/bindings` | リソースバインディング一覧 |
| PATCH  | `/api/services/:id/bindings` | バインディング更新         |

### Deployments

| method | path                                          | description  |
| ------ | --------------------------------------------- | ------------ |
| POST   | `/api/services/:id/deployments`               | デプロイ作成 |
| GET    | `/api/services/:id/deployments`               | デプロイ履歴 |
| GET    | `/api/services/:id/deployments/:deploymentId` | デプロイ詳細 |
| POST   | `/api/services/:id/deployments/rollback`      | ロールバック |

#### `POST /api/services/:id/deployments`

リクエスト:

```json
{
  "bundle": "<base64-encoded-bundle>",
  "deploy_message": "v1.2.0 release",
  "strategy": "direct",
  "provider": { "name": "workers-dispatch" },
  "target": {
    "artifact": { "kind": "worker-bundle" }
  }
}
```

`strategy`: `direct` | `canary` `artifact.kind`: `worker-bundle` |
`container-image`

Idempotency-Key ヘッダーで冪等性を保証可能。

---

## custom-domains

サービスのカスタムドメイン管理。

| method | path                                                     | description          |
| ------ | -------------------------------------------------------- | -------------------- |
| GET    | `/api/services/:id/custom-domains`                       | カスタムドメイン一覧 |
| POST   | `/api/services/:id/custom-domains`                       | カスタムドメイン追加 |
| GET    | `/api/services/:id/custom-domains/:domainId`             | カスタムドメイン詳細 |
| POST   | `/api/services/:id/custom-domains/:domainId/verify`      | ドメイン所有権検証   |
| DELETE | `/api/services/:id/custom-domains/:domainId`             | カスタムドメイン削除 |
| POST   | `/api/services/:id/custom-domains/:domainId/refresh-ssl` | SSL 証明書更新       |

---

## resources

リソースの CRUD・アクセス管理。public surface は Cloudflare-native で、Takos
runtime がその spec を各 backend 上で実現します。Cloudflare backend
では通常そのまま対応する Cloudflare resource に解決され、互換 backend では
provider-backed または Takos-managed implementation に解決されます。

### 基本 CRUD

| method | path                             | description                                      |
| ------ | -------------------------------- | ------------------------------------------------ |
| GET    | `/api/resources`                 | リソース一覧（`space_id` でフィルタ可）          |
| GET    | `/api/resources/shared/:spaceId` | 共有リソース一覧                                 |
| GET    | `/api/resources/type/:type`      | タイプ別リソース一覧                             |
| GET    | `/api/resources/:id`             | リソース詳細（アクセス情報・バインディング含む） |
| GET    | `/api/resources/by-name/:name`   | 名前でリソース取得                               |
| POST   | `/api/resources`                 | リソース作成                                     |
| PATCH  | `/api/resources/:id`             | リソース更新                                     |
| PATCH  | `/api/resources/:id/group`       | group への所属変更                               |
| DELETE | `/api/resources/:id`             | リソース削除                                     |
| DELETE | `/api/resources/by-name/:name`   | 名前でリソース削除                               |

`type`: `sql` | `object-store` | `key-value` | `queue` | `vector-index` |
`analytics-engine` | `secret` | `workflow` | `durable-object`

> legacy Cloudflare-style 名 (`d1` / `r2` / `kv` / `vectorize` /
> `analyticsEngine` / `secretRef` / `durableObject`) も backward compat alias
> として受け付けますが、新規実装では canonical hyphenated 名を推奨します。

### Access

| method | path                                 | description              |
| ------ | ------------------------------------ | ------------------------ |
| GET    | `/api/resources/:id/access`          | アクセス権一覧 _(owner)_ |
| POST   | `/api/resources/:id/access`          | アクセス権付与 _(owner)_ |
| DELETE | `/api/resources/:id/access/:spaceId` | アクセス権取消 _(owner)_ |

#### `POST /api/resources/:id/access`

リクエスト:

```json
{
  "space_id": "ws_abc123",
  "permission": "write"
}
```

`permission`: `read` | `write` | `admin`

### Bindings

| method | path                                           | description                |
| ------ | ---------------------------------------------- | -------------------------- |
| POST   | `/api/resources/:id/bind`                      | サービスバインディング作成 |
| DELETE | `/api/resources/:id/bind/:serviceId`           | バインディング削除         |
| DELETE | `/api/resources/by-name/:name/bind/:serviceId` | 名前でバインディング削除   |

### Tokens

| method | path                                           | description          |
| ------ | ---------------------------------------------- | -------------------- |
| GET    | `/api/resources/:id/tokens`                    | アクセストークン一覧 |
| GET    | `/api/resources/by-name/:name/tokens`          | 名前でトークン一覧   |
| POST   | `/api/resources/:id/tokens`                    | トークン作成         |
| POST   | `/api/resources/by-name/:name/tokens`          | 名前でトークン作成   |
| DELETE | `/api/resources/:id/tokens/:tokenId`           | トークン削除         |
| DELETE | `/api/resources/by-name/:name/tokens/:tokenId` | 名前でトークン削除   |
| GET    | `/api/resources/:id/connection`                | 接続情報取得         |
| GET    | `/api/resources/by-name/:name/connection`      | 名前で接続情報取得   |

### SQL

| method | path                                       | description                                 |
| ------ | ------------------------------------------ | ------------------------------------------- |
| GET    | `/api/resources/:id/sql/tables`            | テーブル一覧                                |
| GET    | `/api/resources/:id/d1/tables`             | テーブル一覧（current D1 path）             |
| GET    | `/api/resources/:id/sql/tables/:tableName` | テーブルデータ取得                          |
| GET    | `/api/resources/:id/d1/tables/:tableName`  | テーブルデータ取得（current D1 path）       |
| POST   | `/api/resources/:id/sql/query`             | SQL クエリ実行                              |
| POST   | `/api/resources/:id/d1/query`              | SQL クエリ実行（current D1 path）           |
| POST   | `/api/resources/:id/sql/export`            | データベースエクスポート                    |
| POST   | `/api/resources/:id/d1/export`             | データベースエクスポート（current D1 path） |

### Object Storage

| method | path                                 | description                         |
| ------ | ------------------------------------ | ----------------------------------- |
| GET    | `/api/resources/:id/objects`         | オブジェクト一覧                    |
| GET    | `/api/resources/:id/r2/objects`      | オブジェクト一覧（current R2 path） |
| GET    | `/api/resources/:id/objects-stats`   | バケット統計                        |
| GET    | `/api/resources/:id/r2/stats`        | バケット統計（current R2 path）     |
| GET    | `/api/resources/:id/objects/:key`    | オブジェクト取得                    |
| PUT    | `/api/resources/:id/objects/:key`    | オブジェクト書き込み                |
| DELETE | `/api/resources/:id/objects/:key`    | オブジェクト削除                    |
| DELETE | `/api/resources/:id/r2/objects/:key` | オブジェクト削除（current R2 path） |

### KV (Key-Value Store)

| method | path                                 | description                           |
| ------ | ------------------------------------ | ------------------------------------- |
| GET    | `/api/resources/:id/kv/entries`      | エントリ一覧（prefix, cursor, limit） |
| GET    | `/api/resources/:id/kv/entries/:key` | エントリ取得                          |
| PUT    | `/api/resources/:id/kv/entries/:key` | エントリ書き込み                      |
| DELETE | `/api/resources/:id/kv/entries/:key` | エントリ削除                          |

---

## apps

first-party app inventory / metadata surface。current implementation では
root-mounted `/api/apps*` を使います。

| method | path                       | description            |
| ------ | -------------------------- | ---------------------- |
| GET    | `/api/apps`                | app 一覧               |
| GET    | `/api/apps/:id`            | app 詳細               |
| PATCH  | `/api/apps/:id`            | app metadata 更新      |
| POST   | `/api/apps/:id/client-key` | app 用 client key 生成 |
| DELETE | `/api/apps/:id`            | app 削除               |

レスポンスには builtin app と custom app の両方が含まれます。space header
が付いている場合は、その space scope に解決された app 一覧を返します。

---

## threads

スレッド / メッセージの CRUD・共有・エクスポート。

| method | path                                  | description                                           |
| ------ | ------------------------------------- | ----------------------------------------------------- |
| GET    | `/api/spaces/:spaceId/threads`        | スレッド一覧（status フィルタ対応）                   |
| GET    | `/api/spaces/:spaceId/threads/search` | スレッド検索（keyword / semantic）                    |
| POST   | `/api/spaces/:spaceId/threads`        | スレッド作成                                          |
| GET    | `/api/threads/:id`                    | スレッド詳細                                          |
| PATCH  | `/api/threads/:id`                    | スレッド更新（title, locale, status, context_window） |
| DELETE | `/api/threads/:id`                    | スレッド削除                                          |
| POST   | `/api/threads/:id/archive`            | アーカイブ                                            |
| POST   | `/api/threads/:id/unarchive`          | アーカイブ解除                                        |

### Messages

| method | path                               | description                                    |
| ------ | ---------------------------------- | ---------------------------------------------- |
| GET    | `/api/threads/:id/messages`        | メッセージタイムライン（ページネーション対応） |
| GET    | `/api/threads/:id/messages/search` | メッセージ検索                                 |
| POST   | `/api/threads/:id/messages`        | メッセージ作成                                 |
| GET    | `/api/threads/:id/history`         | 実行履歴（runs + messages）                    |

### Share

| method | path                                      | description                                  |
| ------ | ----------------------------------------- | -------------------------------------------- |
| POST   | `/api/threads/:id/share`                  | 共有作成（公開 / パスワード保護 / 有効期限） |
| GET    | `/api/threads/:id/shares`                 | 共有一覧                                     |
| POST   | `/api/threads/:id/shares/:shareId/revoke` | 共有取消                                     |

### Export

| method | path                      | description                            |
| ------ | ------------------------- | -------------------------------------- |
| GET    | `/api/threads/:id/export` | スレッドエクスポート（markdown / PDF） |

#### `POST /api/spaces/:spaceId/threads`

リクエスト:

```json
{ "title": "debug" }
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

---

## runs

Run の実行・イベントストリーム・アーティファクト管理。

| method | path                          | description                                     |
| ------ | ----------------------------- | ----------------------------------------------- |
| GET    | `/api/threads/:threadId/runs` | スレッド内 Run 一覧（active_only, cursor 対応） |
| POST   | `/api/threads/:threadId/runs` | Run 作成・実行開始                              |
| GET    | `/api/runs/:id`               | Run 詳細                                        |
| POST   | `/api/runs/:id/cancel`        | Run キャンセル                                  |
| GET    | `/api/runs/:id/events`        | Run イベント取得（last_event_id 対応）          |
| GET    | `/api/runs/:id/sse`           | SSE でリアルタイムイベント受信                  |
| GET    | `/api/runs/:id/ws`            | WebSocket でリアルタイムイベント受信            |
| GET    | `/api/runs/:id/replay`        | イベントリプレイ（cursor ベース）               |

### Artifacts

| method | path                      | description                |
| ------ | ------------------------- | -------------------------- |
| GET    | `/api/runs/:id/artifacts` | Run のアーティファクト一覧 |
| POST   | `/api/runs/:id/artifacts` | アーティファクト作成       |
| GET    | `/api/artifacts/:id`      | アーティファクト取得       |

#### SSE ストリーム

```bash
curl -N \
  -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/runs/run_123/sse
```

Server-Sent Events 形式で Run の状態変化・ログをストリーミングで受信する。

#### SSE event types

`GET /api/runs/:id/events` / `GET /api/runs/:id/sse` で配信される event 種別:

| event        | payload                                  | 意味                                   |
| ------------ | ---------------------------------------- | -------------------------------------- |
| `started`    | `{ agent_type, ... }`                    | run 開始                               |
| `thinking`   | `{ message, iteration?, engine? }`       | 推論中 (progress / debug 情報)         |
| `tool_call`  | `{ tool, input, id }`                    | tool 呼び出し開始                      |
| `tool_result`| `{ tool, output, id }`                   | tool 呼び出し結果                      |
| `message`    | `{ content }`                            | assistant message 追加                 |
| `artifact`   | `{ artifact }`                           | artifact 生成                          |
| `progress`   | `{ message, phase? }`                    | session close など汎用 progress        |
| `completed`  | `{ status: "completed", run, ... }`      | 正常終了 (terminal)                    |
| `error`      | `{ status: "failed", run, error, ... }` | 実行中エラー (terminal)                |
| `cancelled`  | `{ status: "cancelled", run, ... }`     | cancel 要求で停止 (terminal)           |
| `run.failed` | `{ status: "failed", run, error, ... }` | system レベルの失敗 (terminal)         |

terminal event を受信したら client は接続を閉じる。cursor ベースの replay
は `?last_event_id=` query を `/events` endpoint に渡す。

---

## search

セマンティック検索・クイック検索。ベクトル検索は billing gate で計量。

| method | path                                | description                          |
| ------ | ----------------------------------- | ------------------------------------ |
| POST   | `/api/spaces/:spaceId/search`       | セマンティック検索（キャッシュ対応） |
| GET    | `/api/spaces/:spaceId/search/quick` | クイックファイルパス検索             |

#### `POST /api/spaces/:spaceId/search`

リクエスト:

```json
{
  "query": "how to deploy",
  "limit": 10
}
```

レスポンス:

```json
{
  "results": [
    {
      "id": "thread_xxx",
      "kind": "thread",
      "title": "Deployment guide",
      "snippet": "...",
      "score": 0.87
    }
  ],
  "total": 12
}
```

`kind` は `thread` / `file` / `repo` / `memory` のいずれか。`score` は 0.0-1.0 の relevance ranking。

---

## index

インデックス・ベクトル化・知識グラフ。

| method | path                                   | description                                |
| ------ | -------------------------------------- | ------------------------------------------ |
| GET    | `/api/spaces/:spaceId/index/status`    | インデックスステータス                     |
| POST   | `/api/spaces/:spaceId/index/vectorize` | ベクトルインデックス実行（レート制限あり） |
| POST   | `/api/spaces/:spaceId/index/rebuild`   | インデックス再構築（レート制限あり）       |
| POST   | `/api/spaces/:spaceId/index/file`      | 特定ファイルのインデックス                 |
| GET    | `/api/spaces/:spaceId/graph/neighbors` | 知識グラフの隣接ノード取得                 |

---

## memories

ワークスペースメモリの CRUD・検索。

| method | path                                   | description                        |
| ------ | -------------------------------------- | ---------------------------------- |
| GET    | `/api/spaces/:spaceId/memories`        | メモリ一覧（ページネーション対応） |
| GET    | `/api/spaces/:spaceId/memories/search` | メモリ検索                         |
| POST   | `/api/spaces/:spaceId/memories`        | メモリ作成                         |
| GET    | `/api/memories/:id`                    | メモリ詳細                         |
| PATCH  | `/api/memories/:id`                    | メモリ更新                         |
| DELETE | `/api/memories/:id`                    | メモリ削除                         |

---

## reminders

リマインダーの CRUD・トリガー。

| method | path                             | description              |
| ------ | -------------------------------- | ------------------------ |
| GET    | `/api/spaces/:spaceId/reminders` | リマインダー一覧         |
| POST   | `/api/spaces/:spaceId/reminders` | リマインダー作成         |
| GET    | `/api/reminders/:id`             | リマインダー詳細         |
| PATCH  | `/api/reminders/:id`             | リマインダー更新         |
| DELETE | `/api/reminders/:id`             | リマインダー削除         |
| POST   | `/api/reminders/:id/trigger`     | リマインダー手動トリガー |

---

## skills

スキルカタログ・カスタムスキルの管理。`/api/spaces/:spaceId/skills` と
`/api/workspaces/:workspaceId/skills` は同じ操作（`/api/workspaces/`
は互換エイリアス）。

### Catalog

| method | path                                            | description                |
| ------ | ----------------------------------------------- | -------------------------- |
| GET    | `/api/spaces/:spaceId/official-skills`          | 公式スキルカタログ         |
| GET    | `/api/spaces/:spaceId/official-skills/:skillId` | 公式スキル詳細             |
| GET    | `/api/spaces/:spaceId/skills-context`           | 利用可能スキルコンテキスト |

### Custom skills

| method | path                          | description        |
| ------ | ----------------------------- | ------------------ |
| GET    | `/api/spaces/:spaceId/skills` | カスタムスキル一覧 |
| POST   | `/api/spaces/:spaceId/skills` | カスタムスキル作成 |

### SkillExecutionContract

custom skill の `execution_contract` field は agent runner 向けの hint:

```json
{
  "preferred_tools": ["string"],
  "durable_output_hints": ["string"],
  "output_modes": ["text" | "structured" | "artifact"],
  "required_mcp_servers": ["string"],
  "template_ids": ["string"]
}
```

すべての field は optional。runner はこれらを参考に tool 選択や出力形式を決定する。

### By ID

| method | path                                      | description              |
| ------ | ----------------------------------------- | ------------------------ |
| GET    | `/api/spaces/:spaceId/skills/id/:skillId` | ID でスキル取得          |
| PUT    | `/api/spaces/:spaceId/skills/id/:skillId` | ID でスキル更新          |
| PATCH  | `/api/spaces/:spaceId/skills/id/:skillId` | ID でスキル有効/無効切替 |
| DELETE | `/api/spaces/:spaceId/skills/id/:skillId` | ID でスキル削除          |

### By name

| method | path                                     | description               |
| ------ | ---------------------------------------- | ------------------------- |
| GET    | `/api/spaces/:spaceId/skills/:skillName` | 名前でスキル取得          |
| PUT    | `/api/spaces/:spaceId/skills/:skillName` | 名前でスキル更新          |
| PATCH  | `/api/spaces/:spaceId/skills/:skillName` | 名前でスキル有効/無効切替 |
| DELETE | `/api/spaces/:spaceId/skills/:skillName` | 名前でスキル削除          |

---

## sessions

Space File Sync セッションのライフサイクル管理。

| method | path                                 | description                    |
| ------ | ------------------------------------ | ------------------------------ |
| POST   | `/api/spaces/:spaceId/sessions`      | セッション開始                 |
| POST   | `/api/sessions/:sessionId/stop`      | セッション停止（変更コミット） |
| POST   | `/api/sessions/:sessionId/resume`    | セッション再開                 |
| POST   | `/api/sessions/:sessionId/discard`   | セッション破棄                 |
| POST   | `/api/sessions/:sessionId/heartbeat` | ハートビート送信               |
| GET    | `/api/sessions/:sessionId/health`    | セッションヘルスチェック       |

### Lifecycle semantics

| operation | 動作 |
|---|---|
| `stop` | 進行中の session を **commit** して終了 (file 変更が space storage に反映される) |
| `discard` | 進行中の session を **rollback** して終了 (変更を破棄、storage は session 開始前の状態に戻る) |
| `resume` | 一時停止中 (heartbeat 切れ等) の session を再開。新しい heartbeat clock を始める |
| `heartbeat` | session 進行中の keep-alive。停止すると session は idle と判定され、最終的に discard 扱いになる |

---

## git

ワークスペーススコープの Git 操作。

| method | path                                         | description   |
| ------ | -------------------------------------------- | ------------- |
| POST   | `/api/spaces/:spaceId/git/commit`            | コミット作成  |
| GET    | `/api/spaces/:spaceId/git/log`               | コミット履歴  |
| GET    | `/api/spaces/:spaceId/git/commits/:commitId` | コミット詳細  |
| GET    | `/api/spaces/:spaceId/git/diff/:commitId`    | コミット diff |
| POST   | `/api/spaces/:spaceId/git/restore`           | ファイル復元  |
| GET    | `/api/spaces/:spaceId/git/history/:path`     | ファイル履歴  |

---

## repos

リポジトリの CRUD・Git 操作・ワークフロー管理。

### 基本 CRUD

| method | path                         | description                    |
| ------ | ---------------------------- | ------------------------------ |
| GET    | `/api/spaces/:spaceId/repos` | ワークスペース内リポジトリ一覧 |
| POST   | `/api/spaces/:spaceId/repos` | リポジトリ作成                 |
| GET    | `/api/repos/:repoId`         | リポジトリ詳細                 |
| PATCH  | `/api/repos/:repoId`         | リポジトリ設定更新             |
| DELETE | `/api/repos/:repoId`         | リポジトリ削除                 |

#### `GET /api/spaces/:spaceId/repos`

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

### Stars / Forks

| method | path                      | description             |
| ------ | ------------------------- | ----------------------- |
| POST   | `/api/repos/:repoId/star` | star 追加               |
| DELETE | `/api/repos/:repoId/star` | star 削除               |
| GET    | `/api/repos/:repoId/star` | star 状態確認           |
| GET    | `/api/repos/starred`      | star 済みリポジトリ一覧 |
| POST   | `/api/repos/:repoId/fork` | リポジトリ fork         |

### Branches

| method | path                                              | description            |
| ------ | ------------------------------------------------- | ---------------------- |
| GET    | `/api/repos/:repoId/branches`                     | ブランチ一覧           |
| POST   | `/api/repos/:repoId/branches`                     | ブランチ作成           |
| DELETE | `/api/repos/:repoId/branches/:branchName`         | ブランチ削除           |
| POST   | `/api/repos/:repoId/branches/:branchName/default` | デフォルトブランチ設定 |

### Commits

| method | path                         | description                                    |
| ------ | ---------------------------- | ---------------------------------------------- |
| GET    | `/api/repos/:repoId/commits` | コミット一覧（ページネーション・フィルタ対応） |

### Git tree / blob

| method | path                                | description                  |
| ------ | ----------------------------------- | ---------------------------- |
| GET    | `/api/repos/:repoId/tree/:ref`      | ルートディレクトリツリー取得 |
| GET    | `/api/repos/:repoId/tree/:ref/*`    | サブディレクトリツリー取得   |
| GET    | `/api/repos/:repoId/blob/:ref`      | ルートファイル内容取得       |
| GET    | `/api/repos/:repoId/blob/:ref/*`    | ファイル内容取得             |
| GET    | `/api/repos/:repoId/log`            | コミットログ                 |
| GET    | `/api/repos/:repoId/log/:ref`       | ref 指定コミットログ         |
| GET    | `/api/repos/:repoId/log/:ref/:path` | パス指定コミットログ         |

### Search / Diff / Blame

| method | path                                  | description                |
| ------ | ------------------------------------- | -------------------------- |
| GET    | `/api/repos/:repoId/search`           | リポジトリ内コンテンツ検索 |
| GET    | `/api/repos/:repoId/semantic-search`  | セマンティック検索         |
| GET    | `/api/repos/:repoId/diff/:baseHead`   | ref 間 diff                |
| GET    | `/api/repos/:repoId/blame/:ref`       | ルートファイル blame       |
| GET    | `/api/repos/:repoId/blame/:ref/:path` | ファイル blame             |

### Status / Export

| method | path                                | description                    |
| ------ | ----------------------------------- | ------------------------------ |
| GET    | `/api/repos/:repoId/status`         | リポジトリステータス           |
| GET    | `/api/repos/:repoId/export`         | リポジトリエクスポート         |
| POST   | `/api/repos/:repoId/commit`         | コミット作成                   |
| POST   | `/api/repos/:repoId/import`         | インポート                     |
| POST   | `/api/repos/:repoId/semantic-index` | セマンティックインデックス実行 |

### External Import

| method | path                              | description                   |
| ------ | --------------------------------- | ----------------------------- |
| POST   | `/api/repos/import-external`      | 外部 Git リポジトリインポート |
| POST   | `/api/repos/:repoId/fetch-remote` | リモートから更新取得          |

#### `POST /api/repos/import-external`

リクエスト:

```json
{
  "url": "https://github.com/example/repo.git",
  "space_id": "ws_abc123",
  "name": "my-imported-repo",
  "auth": { "token": "ghp_..." },
  "description": "Imported repository",
  "visibility": "private"
}
```

### Sync

| method | path                             | description                    |
| ------ | -------------------------------- | ------------------------------ |
| POST   | `/api/repos/:repoId/fetch`       | upstream から fetch（fork 用） |
| POST   | `/api/repos/:repoId/sync`        | リポジトリ同期                 |
| GET    | `/api/repos/:repoId/sync/status` | 同期ステータス                 |

### Workflows

| method | path                                      | description              |
| ------ | ----------------------------------------- | ------------------------ |
| GET    | `/api/repos/:repoId/workflows`            | ワークフローファイル一覧 |
| GET    | `/api/repos/:repoId/workflows/:path`      | ワークフロー詳細         |
| DELETE | `/api/repos/:repoId/workflows/:path`      | ワークフロー削除         |
| POST   | `/api/repos/:repoId/workflows/:path/sync` | ワークフロー同期         |
| POST   | `/api/repos/:repoId/workflows/sync-all`   | 全ワークフロー一括同期   |

---

## repos.actions

ワークフロー実行・シークレット・アーティファクト管理。

### Runs

| method | path                                            | description                          |
| ------ | ----------------------------------------------- | ------------------------------------ |
| GET    | `/api/repos/:repoId/actions/runs`               | ワークフロー実行一覧（フィルタ対応） |
| POST   | `/api/repos/:repoId/actions/runs`               | ワークフロー実行開始                 |
| GET    | `/api/repos/:repoId/actions/runs/:runId`        | 実行詳細                             |
| GET    | `/api/repos/:repoId/actions/runs/:runId/jobs`   | 実行のジョブ一覧                     |
| GET    | `/api/repos/:repoId/actions/runs/:runId/ws`     | 実行イベント WebSocket               |
| POST   | `/api/repos/:repoId/actions/runs/:runId/cancel` | 実行キャンセル                       |
| POST   | `/api/repos/:repoId/actions/runs/:runId/rerun`  | 実行再実行                           |

### Jobs

| method | path                                          | description                    |
| ------ | --------------------------------------------- | ------------------------------ |
| GET    | `/api/repos/:repoId/actions/jobs/:jobId`      | ジョブ詳細（ステップ情報含む） |
| GET    | `/api/repos/:repoId/actions/jobs/:jobId/logs` | ジョブログ取得（range 対応）   |

ログの range パラメータ: `offset` (バイト位置), `limit` (バイト数)

### Secrets

| method | path                                       | description                            |
| ------ | ------------------------------------------ | -------------------------------------- |
| GET    | `/api/repos/:repoId/actions/secrets`       | シークレット一覧 _(owner/admin)_       |
| PUT    | `/api/repos/:repoId/actions/secrets/:name` | シークレット作成・更新 _(owner/admin)_ |
| DELETE | `/api/repos/:repoId/actions/secrets/:name` | シークレット削除 _(owner/admin)_       |

シークレット名は `^[A-Z_][A-Z0-9_]*$` の形式が必要。

### Artifacts

| method | path                                               | description                                 |
| ------ | -------------------------------------------------- | ------------------------------------------- |
| GET    | `/api/repos/:repoId/actions/runs/:runId/artifacts` | 実行のアーティファクト一覧                  |
| GET    | `/api/repos/:repoId/actions/artifacts/:artifactId` | アーティファクトダウンロード                |
| DELETE | `/api/repos/:repoId/actions/artifacts/:artifactId` | アーティファクト削除 _(owner/admin/editor)_ |

---

## repos.releases

リリースの CRUD・アセット管理。

### Release CRUD

| method | path                                 | description                          |
| ------ | ------------------------------------ | ------------------------------------ |
| GET    | `/api/repos/:repoId/releases`        | リリース一覧（ページネーション対応） |
| GET    | `/api/repos/:repoId/releases/latest` | 最新リリース取得                     |
| GET    | `/api/repos/:repoId/releases/:tag`   | タグでリリース取得                   |
| POST   | `/api/repos/:repoId/releases`        | リリース作成                         |
| PATCH  | `/api/repos/:repoId/releases/:tag`   | リリース更新                         |
| DELETE | `/api/repos/:repoId/releases/:tag`   | リリース削除                         |

### Release Assets

| method | path                                                        | description                                 |
| ------ | ----------------------------------------------------------- | ------------------------------------------- |
| GET    | `/api/repos/:repoId/releases/:tag/assets`                   | アセット一覧                                |
| POST   | `/api/repos/:repoId/releases/:tag/assets`                   | アセットアップロード（multipart/form-data） |
| GET    | `/api/repos/:repoId/releases/:tag/assets/:assetId/download` | アセットダウンロード                        |
| DELETE | `/api/repos/:repoId/releases/:tag/assets/:assetId`          | アセット削除                                |

アセットの最大サイズは 100MB。対応ファイル形式: `.takopack`, `.zip`, `.tar.gz`,
`.tgz`, `.json` 等。

---

## pull-requests

プルリクエストの作成・レビュー・マージ。

### PR CRUD

| method | path                                       | description             |
| ------ | ------------------------------------------ | ----------------------- |
| GET    | `/api/repos/:repoId/pulls`                 | PR 一覧（フィルタ対応） |
| POST   | `/api/repos/:repoId/pulls`                 | PR 作成                 |
| GET    | `/api/repos/:repoId/pulls/:prNumber`       | PR 詳細                 |
| PATCH  | `/api/repos/:repoId/pulls/:prNumber`       | PR 更新                 |
| POST   | `/api/repos/:repoId/pulls/:prNumber/close` | PR クローズ             |
| GET    | `/api/repos/:repoId/pulls/:prNumber/diff`  | PR diff 取得            |

`status` field の値: `open` (default) / `closed` / `merged`。state transitions: `open → closed` または `open → merged`。`merged` は merge endpoint (`/merge`) 経由でのみ設定される。

### Comments

| method | path                                          | description  |
| ------ | --------------------------------------------- | ------------ |
| GET    | `/api/repos/:repoId/pulls/:prNumber/comments` | コメント一覧 |
| POST   | `/api/repos/:repoId/pulls/:prNumber/comments` | コメント追加 |

### Reviews

| method | path                                           | description     |
| ------ | ---------------------------------------------- | --------------- |
| GET    | `/api/repos/:repoId/pulls/:prNumber/reviews`   | レビュー一覧    |
| POST   | `/api/repos/:repoId/pulls/:prNumber/reviews`   | レビュー投稿    |
| POST   | `/api/repos/:repoId/pulls/:prNumber/ai-review` | AI レビュー実行 |

### Merge

| method | path                                           | description                          |
| ------ | ---------------------------------------------- | ------------------------------------ |
| GET    | `/api/repos/:repoId/pulls/:prNumber/conflicts` | コンフリクト確認                     |
| POST   | `/api/repos/:repoId/pulls/:prNumber/resolve`   | コンフリクト解決                     |
| POST   | `/api/repos/:repoId/pulls/:prNumber/merge`     | PR マージ（merge / squash / rebase） |

---

## agent-tasks

エージェントタスクのオーケストレーション。

| method | path                               | description    |
| ------ | ---------------------------------- | -------------- |
| GET    | `/api/spaces/:spaceId/agent-tasks` | タスク一覧     |
| POST   | `/api/spaces/:spaceId/agent-tasks` | タスク作成     |
| GET    | `/api/agent-tasks/:id`             | タスク詳細     |
| PATCH  | `/api/agent-tasks/:id`             | タスク更新     |
| DELETE | `/api/agent-tasks/:id`             | タスク削除     |
| POST   | `/api/agent-tasks/:id/plan`        | 実行プラン生成 |

`status` field の値: `planned` / `in_progress` / `completed` / `cancelled` / `failed`

---

## notifications

通知の一覧・既読管理・リアルタイム配信。

| method | path                              | description                                |
| ------ | --------------------------------- | ------------------------------------------ |
| GET    | `/api/notifications`              | 通知一覧（ページネーション・フィルタ対応） |
| GET    | `/api/notifications/unread-count` | 未読件数                                   |
| PATCH  | `/api/notifications/:id/read`     | 既読にする                                 |
| GET    | `/api/notifications/preferences`  | 通知設定取得                               |
| PATCH  | `/api/notifications/preferences`  | 通知設定更新                               |
| GET    | `/api/notifications/settings`     | 通知詳細設定（muted_until 等）             |
| PATCH  | `/api/notifications/settings`     | 通知詳細設定更新                           |

### リアルタイム配信

| method | path                     | description                      |
| ------ | ------------------------ | -------------------------------- |
| GET    | `/api/notifications/sse` | SSE でリアルタイム通知受信       |
| GET    | `/api/notifications/ws`  | WebSocket でリアルタイム通知受信 |

::: tip Notification delivery model
- **Storage**: 永続化された DB row + Durable Object 内の in-memory ring buffer
- **Retention**: ring buffer は最新の N event を保持 (replay window)、DB row は user が `read` するまで残る
- **Delivery guarantee**: at-most-once (best-effort)。SSE / WebSocket 接続切断中の event は ring buffer 内なら replay される
- **Replay**: SSE 接続時に `Last-Event-ID` header をサポート (ring buffer の範囲内で replay)
:::

```bash
curl -N \
  -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/notifications/sse
```

---

## app-deployments

アプリデプロイ管理。`source` は `git_ref` と `manifest` の 2 種類を
discriminated union として受け付けます。`takos install` は catalog metadata から
`repository_url + tag` を解決し、`source.kind = "git_ref"` で同じ endpoint
を使います。ローカル CLI の `takos deploy` は working tree から parse した flat
manifest を `source.kind = "manifest"` payload として送信します。

remote public repo の source 解決は bounded/configurable な full pack
を先に試し、pack size / object count / inflated size のような
content-size・pack-limit 系の失敗だけを blobless partial fetch の対象にします。
任意の fetch error で fallback するわけではありません。blobless partial fetch は
remote が `filter` と `allow-reachable-sha1-in-want` を advertise
している場合に限ります。archive download は GitHub / GitLab public repo 向けの
host-specific な最終 fallback です。上限は `TAKOS_APP_DEPLOY_REMOTE_*`
環境変数で調整できます。

| method | path                                                             | description                    |
| ------ | ---------------------------------------------------------------- | ------------------------------ |
| POST   | `/api/spaces/:spaceId/app-deployments`                           | デプロイ開始                   |
| GET    | `/api/spaces/:spaceId/app-deployments`                           | デプロイ一覧                   |
| GET    | `/api/spaces/:spaceId/app-deployments/:appDeploymentId`          | デプロイ詳細                   |
| POST   | `/api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback` | ロールバック                   |
| DELETE | `/api/spaces/:spaceId/app-deployments/:appDeploymentId`          | deployment history record 削除 |

### App deployment status

| status | 意味 |
|---|---|
| `pending` | record 作成済み、apply 開始前 |
| `building` | workflow / artifact build 中 |
| `deploying` | provider apply 中 (worker upload, resource provision, routing update) |
| `active` | apply 成功、現在 serving |
| `failed` | apply 失敗 |
| `rolled_back` | 後続の rollback で前 deployment に戻された |
| `archived` | より新しい deployment に置き換えられた |

state transitions: `pending → building → deploying → active`、または途中で `failed`。`active` deployment は後続 deploy で `archived`、rollback 操作で `rolled_back` になる。

#### `POST /api/spaces/:spaceId/app-deployments`

`source` は `kind` で分岐する discriminated union です:

- `source.kind = "git_ref"` — repository URL + ref/ref_type を指定し、control
  plane が repo を fetch して manifest と artifact を解決します。`takos install`
  / `takos deploy <URL>` がこの形式を使います。
- `source.kind = "manifest"` — CLI がローカルで parse した flat `AppManifest` を
  payload として送信します。必要に応じて `artifacts` (inline worker bundle 等)
  を添えます。`takos deploy`（ローカル manifest）がこの形式を使います。

`git_ref` リクエスト:

```json
{
  "group_name": "my-app",
  "env": "staging",
  "provider": "cloudflare",
  "source": {
    "kind": "git_ref",
    "repository_url": "https://github.com/acme/my-app.git",
    "ref": "main",
    "ref_type": "branch"
  }
}
```

`manifest` リクエスト:

```json
{
  "group_name": "my-app",
  "env": "staging",
  "provider": "cloudflare",
  "source": {
    "kind": "manifest",
    "manifest": {
      "name": "my-app",
      "compute": {
        "web": {
          "build": {
            "fromWorkflow": {
              "path": ".takos/workflows/deploy.yml",
              "job": "bundle",
              "artifact": "web",
              "artifactPath": "dist/worker"
            }
          }
        }
      },
      "storage": { "db": { "type": "sql", "bind": "DB" } },
      "routes": [{ "target": "web", "path": "/" }],
      "publish": [{ "type": "UiSurface", "path": "/" }]
    },
    "artifacts": [
      { "name": "web", "bundle": "<base64-bundle>" }
    ]
  }
}
```

レスポンス (201):

```json
{
  "app_deployment": {
    "id": "adep_xyz789",
    "group": {
      "id": "grp_123",
      "name": "my-app"
    },
    "status": "applied",
    "manifest_version": "1.0.0",
    "hostnames": ["my-app.example.com"],
    "rollback_of_app_deployment_id": null,
    "snapshot": {
      "state": "available",
      "rollback_ready": true,
      "format": "takopack-v1"
    },
    "source": {
      "kind": "git_ref",
      "repository_url": "https://github.com/acme/my-app.git",
      "ref": "main",
      "ref_type": "branch",
      "commit_sha": "abc123def456",
      "resolved_repo_id": null
    },
    "created_at": "2026-03-28T00:00:00.000Z",
    "updated_at": "2026-03-28T00:00:00.000Z"
  },
  "apply_result": {
    "applied": [],
    "skipped": []
  }
}
```

`POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback` は
snapshot に保存された source / artifact / provider / env を既存 group
に再適用します。current group metadata より snapshot 側の execution context
を優先します。対象 group row が既に削除されている場合は失敗し、 rollback が
group を再生成することはありません。

---

## browser-sessions

ブラウザセッションのライフサイクル管理。

| method | path                                    | description            |
| ------ | --------------------------------------- | ---------------------- |
| POST   | `/api/spaces/:spaceId/browser-sessions` | セッション作成         |
| GET    | `/api/browser-sessions/:id`             | セッション情報取得     |
| POST   | `/api/browser-sessions/:id/goto`        | URL ナビゲーション     |
| POST   | `/api/browser-sessions/:id/action`      | ブラウザアクション実行 |
| POST   | `/api/browser-sessions/:id/extract`     | ページデータ抽出       |
| GET    | `/api/browser-sessions/:id/html`        | HTML コンテンツ取得    |
| GET    | `/api/browser-sessions/:id/screenshot`  | スクリーンショット取得 |
| POST   | `/api/browser-sessions/:id/pdf`         | PDF 生成               |
| DELETE | `/api/browser-sessions/:id`             | セッション破棄         |

::: tip Browser session lifecycle
Browser session は外部 `BROWSER_HOST` service に delegate される。idle timeout /
TTL / auto-close の挙動は `BROWSER_HOST` 実装に依存する。明示的に session を
閉じるには `DELETE /api/browser-sessions/:id` を呼ぶ。
:::

---

## groups

デプロイグループの管理・プラン・適用。

| method | path                                               | description                                                   |
| ------ | -------------------------------------------------- | ------------------------------------------------------------- |
| GET    | `/api/spaces/:spaceId/groups`                      | グループ一覧                                                  |
| POST   | `/api/spaces/:spaceId/groups`                      | グループ作成 _(owner/admin/editor)_                           |
| POST   | `/api/spaces/:spaceId/groups/plan`                 | group_name 指定で non-mutating preview _(owner/admin/editor)_ |
| POST   | `/api/spaces/:spaceId/groups/apply`                | group_name 指定で apply _(owner/admin/editor)_                |
| POST   | `/api/spaces/:spaceId/groups/uninstall`            | group_name 指定で uninstall _(owner/admin/editor)_            |
| GET    | `/api/spaces/:spaceId/groups/:groupId`             | グループ詳細（インベントリ含む）                              |
| PATCH  | `/api/spaces/:spaceId/groups/:groupId/metadata`    | グループ metadata 更新 _(owner/admin/editor)_                 |
| GET    | `/api/spaces/:spaceId/groups/:groupId/desired`     | desired app manifest 取得                                     |
| PUT    | `/api/spaces/:spaceId/groups/:groupId/desired`     | desired app manifest 置換 _(owner/admin/editor)_              |
| DELETE | `/api/spaces/:spaceId/groups/:groupId`             | グループ削除 _(owner/admin)_                                  |
| GET    | `/api/spaces/:spaceId/groups/:groupId/resources`   | グループリソース一覧                                          |
| GET    | `/api/spaces/:spaceId/groups/:groupId/services`    | グループサービス一覧                                          |
| GET    | `/api/spaces/:spaceId/groups/:groupId/deployments` | グループデプロイ一覧                                          |
| POST   | `/api/spaces/:spaceId/groups/:groupId/plan`        | 既存 group ID 向けマニフェストプラン _(owner/admin/editor)_   |
| POST   | `/api/spaces/:spaceId/groups/:groupId/apply`       | 既存 group ID 向けマニフェスト適用 _(owner/admin/editor)_     |
| POST   | `/api/spaces/:spaceId/groups/:groupId/rollback`    | group を直前 snapshot にロールバック _(owner/admin/editor)_   |
| GET    | `/api/spaces/:spaceId/groups/:groupId/updates`     | 更新チェック                                                  |

`POST /api/spaces/:spaceId/groups/:groupId/rollback` は対象 group に対して
直前成功の app deployment snapshot を再適用し、apply pipeline を通して reconcile
します。

レスポンス:

```json
{
  "group_id": "grp_123",
  "deployment_id": "dep_abc",
  "rolled_back_to": "adep_prev456",
  "app_deployment": {
    "id": "adep_prev456",
    "group": { "id": "grp_123", "name": "my-app" },
    "status": "applied"
  },
  "apply_result": {
    "applied": [],
    "skipped": []
  }
}
```

`POST /api/spaces/:spaceId/groups/plan` と
`POST /api/spaces/:spaceId/groups/apply` は **group bulk authoring surface**
です。group は primitive 群を束ねた bulk lifecycle unit (Layer 2) であり、API
はその group に対して reconcile を実行します。`plan` は non-mutating preview、
`apply` は必要なら group を作成して反映します。
`POST /api/spaces/:spaceId/groups/uninstall` は empty desired state を apply
して inventory を drain したあと group を削除します。

primitive (compute / storage / route / publish) を個別に CRUD したい場合は
`/api/services/*` / `/api/resources/*` / `/api/services/:id/custom-domains/*`
などの primitive surface (Layer 1)
を直接呼び出します。`PATCH /api/services/:id/group` /
`PATCH /api/resources/:id/group` で既存 standalone primitive を group に
所属させることもできます。

group には source projection が保存されます。`takos deploy` は local working
tree 由来でも repo/ref 由来でも同じ pipeline を通り、いずれの場合も immutable な
app deployment record を作って `currentAppDeploymentId` を更新します。`source`
field （`local` / `repo:owner/repo@ref`）は manifest の出どころを示す metadata
であり、 lifecycle の差ではありません。`groups/apply` も同じく snapshot
を作ります。

`POST /api/spaces/:spaceId/groups/uninstall` は terminal 操作です。group row
を削除したあとは `app-deployments/:id/rollback` で deleted group
を再生成できません。

---

## billing

課金・使用量・サブスクリプション管理。

| method | path                             | description                               |
| ------ | -------------------------------- | ----------------------------------------- |
| GET    | `/api/billing`                   | 課金情報取得                              |
| GET    | `/api/billing/usage`             | 当月使用量                                |
| POST   | `/api/billing/subscribe`         | サブスクリプション開始（Stripe Checkout） |
| POST   | `/api/billing/credits/checkout`  | クレジットトップアップ（Stripe Checkout） |
| POST   | `/api/billing/portal`            | Stripe カスタマーポータルセッション作成   |
| GET    | `/api/billing/invoices`          | 請求書一覧                                |
| GET    | `/api/billing/invoices/:id/pdf`  | 請求書 PDF                                |
| POST   | `/api/billing/invoices/:id/send` | 請求書メール送信                          |

### Webhook

| method | path                   | auth             | description               |
| ------ | ---------------------- | ---------------- | ------------------------- |
| POST   | `/api/billing/webhook` | Stripe signature | Stripe webhook ハンドラー |

---

## auth

認証・プロファイル操作。

| method | path                       | description                          |
| ------ | -------------------------- | ------------------------------------ |
| GET    | `/api/auth/me`             | 認証中ユーザー情報                   |
| POST   | `/api/auth/setup-username` | 初期ユーザー名設定                   |
| PATCH  | `/api/auth/profile`        | プロファイル更新（表示名・アバター） |
| POST   | `/api/auth/logout`         | ログアウト                           |

---

## oauth-consent

OAuth 同意 UI 用 API。

| method | path                            | description                |
| ------ | ------------------------------- | -------------------------- |
| GET    | `/api/oauth/authorize/context`  | 認可コンテキスト取得       |
| POST   | `/api/oauth/authorize/decision` | 同意決定（approve / deny） |
| GET    | `/api/oauth/device/context`     | デバイスフローコンテキスト |
| POST   | `/api/oauth/device/decision`    | デバイスフロー決定         |

---

## Non-API routes

### smart-http

Git Smart HTTP プロトコル。`git clone`, `git push` 等で使用。

| method | path                                     | description                 |
| ------ | ---------------------------------------- | --------------------------- |
| GET    | `/git/:owner/:repo.git/info/refs`        | Git reference advertisement |
| POST   | `/git/:owner/:repo.git/git-upload-pack`  | Git fetch / clone           |
| POST   | `/git/:owner/:repo.git/git-receive-pack` | Git push                    |

`:owner` はユーザー名またはワークスペーススラッグ。認証は HTTP
Basic（PAT）または匿名（公開リポジトリの読み取り）。

```bash
git clone https://your-takos.example/git/tako/my-app.git
```

### well-known

OAuth / OIDC ディスカバリーエンドポイント。

| method | path                                      | description                                        |
| ------ | ----------------------------------------- | -------------------------------------------------- |
| GET    | `/.well-known/oauth-authorization-server` | OAuth 2.0 Authorization Server Metadata (RFC 8414) |
| GET    | `/.well-known/jwks.json`                  | JSON Web Key Set                                   |
| GET    | `/.well-known/openid-configuration`       | OpenID Connect Discovery                           |

### activitypub-store

ActivityPub フェデレーションエンドポイント。

| method | path                                              | description            |
| ------ | ------------------------------------------------- | ---------------------- |
| GET    | `/.well-known/webfinger`                          | WebFinger プロトコル   |
| GET    | `/ns/takos-git`                                   | Takos Git 名前空間定義 |
| GET    | `/ap/stores/:store`                               | ストアアクター情報     |
| GET    | `/ap/stores/:store/search`                        | 検索サービス情報       |
| POST   | `/ap/stores/:store/inbox`                         | ストア Inbox           |
| GET    | `/ap/stores/:store/followers`                     | フォロワーコレクション |
| GET    | `/ap/stores/:store/repositories`                  | リポジトリ一覧         |
| GET    | `/ap/stores/:store/search/repositories`           | リポジトリ検索         |
| GET    | `/ap/stores/:store/repositories/:owner/:repoName` | リポジトリオブジェクト |
| GET    | `/ap/stores/:store/outbox`                        | アクティビティフィード |

### oauth-server

OAuth 2.0 サーバーエンドポイント。詳しいフローは
[OAuth ドキュメント](/apps/oauth) を参照してください。

| method | path                        | description                                                                                  |
| ------ | --------------------------- | -------------------------------------------------------------------------------------------- |
| GET    | `/oauth/authorize`          | 認可エンドポイント (Authorization Code Flow)                                                 |
| POST   | `/oauth/device/code`        | Device Authorization Grant の device_code 発行 (RFC 8628)                                    |
| POST   | `/oauth/token`              | トークンエンドポイント（authorization_code, refresh_token, client_credentials, device_code） |
| POST   | `/oauth/introspect`         | トークンイントロスペクション                                                                 |
| POST   | `/oauth/revoke`             | トークン失効                                                                                 |
| GET    | `/oauth/userinfo`           | OpenID Connect UserInfo                                                                      |
| POST   | `/oauth/register`           | 動的クライアント登録                                                                         |
| GET    | `/oauth/register/:clientId` | クライアント登録情報取得                                                                     |

::: tip Audience claim validation
OAuth access token (`tak_oat_...`) の `aud` claim は issuance 時に **`client_id`** を埋め込みます。
validation 側 (introspect / API auth middleware) では legacy compatibility のため `client_id` / `issuer` / `${issuer}/api` のいずれかを accept する fallback がある。
:::

### auth (server-side)

サーバーサイド認証フロー。

| method | path                         | description                  |
| ------ | ---------------------------- | ---------------------------- |
| GET    | `/auth/login`                | Google OAuth フロー開始      |
| GET    | `/auth/cli`                  | CLI 認証エンドポイント       |
| GET    | `/auth/external/session`     | 外部サービス用セッション確認 |
| GET    | `/auth/link/google`          | Google アカウントリンク開始  |
| GET    | `/auth/link/google/callback` | Google リンクコールバック    |

---

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
  -d '{"source":{"kind":"git_ref","repository_url":"https://github.com/acme/my-app.git","ref":"main","ref_type":"branch"}}' \
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

### space 一覧を取得

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

### リポジトリ内ファイルを取得

```bash
curl -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/repos/repo_123/git/blob/main/src/index.ts
```

### PR を作成

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"title":"Fix bug","head":"fix/bug","base":"main"}' \
  https://your-takos.example/api/repos/repo_123/pulls
```

### サービスをデプロイ

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"bundle":"<base64>","deploy_message":"v1.0"}' \
  https://your-takos.example/api/services/svc_123/deployments
```

### SQL リソースにクエリ実行

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"sql":"SELECT * FROM users LIMIT 10"}' \
  https://your-takos.example/api/resources/res_123/sql/query
```

### グループにマニフェスト適用

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"manifest":{...}}' \
  https://your-takos.example/api/spaces/ws_123/groups/grp_456/apply
```

---

## implementation note

deploy family は current public surface です。`app-deployments` は `git_ref` /
`manifest` の 2 つの source kind と immutable snapshot rollback を public
contract として扱います。rollback は snapshot execution context を含み、 既存
group があることを前提にします。

## 次に読むページ

- [Deploy System](/deploy/)
- [CLI command reference](/reference/cli)
- [用語集](/reference/glossary)
