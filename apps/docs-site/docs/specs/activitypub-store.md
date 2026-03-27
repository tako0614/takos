# ActivityPub Store 仕様

Revision: 2026-03-28 r2
Status: 確定仕様

Takos の Store は **ActivityPub** をベースとしたパッケージリポジトリの発見・配布メカニズムです。
フェデレーション可能な Store Actor を通じて、リモートの Takos インスタンスからリポジトリを発見・インストールできます。

関連ドキュメント:

- [Package / Ecosystem](/concepts/packages-and-ecosystem) — パッケージエコシステムの概念
- [`.takos/app.yml`](/specs/app-manifest) — パッケージマニフェスト
- [Deploy System v1](/specs/deploy-system) — デプロイとリリース

---

## 1. 概要

Store は ActivityPub ベースのリポジトリ配布の仕組みです。以下の役割を担います。

- **発見 (Discovery)** — WebFinger と ActivityPub Actor によるリポジトリの発見
- **一覧 (Listing)** — Repositories Collection によるリポジトリメタデータの公開
- **検索 (Search)** — リポジトリの全文検索
- **更新通知 (Notification)** — Outbox のアクティビティストリームによる変更の配信
- **インストール (Installation)** — リモートストアからのリポジトリインストール

### 設計原則

1. **Pull-only** — Store は outbox を公開するのみ。inbox は未実装 (501 を返す)
2. **ActivityPub 互換** — 標準の ActivityPub / ActivityStreams 2.0 語彙 + `tkg` (takos-git) 拡張を使用
3. **WebFinger 発見** — 標準のリソース発見プロトコルに従う
4. **SSRF 保護** — リモート Store の fetch 時にプライベート IP / 内部 TLD をブロック

---

## 2. WebFinger 発見

### リクエスト

```http
GET /.well-known/webfinger?resource=acct:{storeSlug}@{domain}
```

`resource` パラメータは次の形式を受け付けます。

- `acct:{storeSlug}@{domain}` — acct URI 形式
- `https://{domain}/ap/stores/{storeSlug}` — Actor URL 形式

### レスポンス

```json
{
  "subject": "acct:{storeSlug}@{domain}",
  "aliases": [
    "https://takos.example.dev/ap/stores/{storeSlug}"
  ],
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://takos.example.dev/ap/stores/{storeSlug}"
    }
  ]
}
```

Content-Type: `application/jrd+json; charset=utf-8`

---

## 3. Store Actor

Store Actor は ActivityPub の `Group` 型 Actor です。

### リクエスト

```http
GET /ap/stores/{storeSlug}
Accept: application/activity+json
```

### レスポンス

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    {
      "tkg": "https://takos.example.dev/ns/takos-git#",
      "GitRepository": "tkg:GitRepository",
      "SearchService": "tkg:SearchService"
    }
  ],
  "id": "https://takos.example.dev/ap/stores/official",
  "type": "Group",
  "preferredUsername": "official",
  "name": "Official Store",
  "summary": "Public repository catalog for Official Store",
  "url": "https://takos.example.dev/ap/stores/official",
  "icon": { "type": "Image", "url": "https://takos.example.dev/icon.png" },
  "inbox": "https://takos.example.dev/ap/stores/official/inbox",
  "outbox": "https://takos.example.dev/ap/stores/official/outbox",
  "followers": "https://takos.example.dev/ap/stores/official/followers",
  "publicKey": {
    "id": "https://takos.example.dev/ap/stores/official#main-key",
    "owner": "https://takos.example.dev/ap/stores/official",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  },
  "tkg:repositories": "https://takos.example.dev/ap/stores/official/repositories",
  "tkg:search": "https://takos.example.dev/ap/stores/official/search",
  "tkg:repositorySearch": "https://takos.example.dev/ap/stores/official/search/repositories",
  "tkg:distributionMode": "pull-only"
}
```

Content-Type: `application/activity+json; charset=utf-8`

| フィールド | 説明 |
| --- | --- |
| `type` | 常に `"Group"` |
| `icon` | Store の画像がある場合に含まれる |
| `tkg:repositories` | Repositories Collection の URL |
| `tkg:search` | Search Service の URL |
| `tkg:repositorySearch` | リポジトリ検索の直接 URL |
| `tkg:distributionMode` | 常に `"pull-only"` |

---

## 4. Repositories Collection

### リクエスト

```http
GET /ap/stores/{storeSlug}/repositories
GET /ap/stores/{storeSlug}/repositories?page=1&limit=20&expand=object
```

| パラメータ | デフォルト | 説明 |
| --- | --- | --- |
| `page` | なし | 指定すると `OrderedCollectionPage` を返す |
| `limit` | 20 (max 100) | ページあたりの件数 |
| `expand` | なし | `object` を指定すると完全なオブジェクトを含む。省略時は ID 文字列のみ |

### コレクション概要 (page パラメータなし)

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://takos.example.dev/ap/stores/official/repositories",
  "type": "OrderedCollection",
  "totalItems": 42,
  "first": "https://takos.example.dev/ap/stores/official/repositories?page=1"
}
```

### Repository オブジェクト

```json
{
  "id": "https://takos.example.dev/ap/stores/official/repositories/tako/takos-computer",
  "type": ["Document", "tkg:GitRepository"],
  "name": "takos-computer",
  "summary": "Browser automation and agent executor service",
  "url": "https://takos.example.dev/@tako/takos-computer",
  "published": "2026-01-15T10:00:00Z",
  "updated": "2026-03-20T08:30:00Z",
  "attributedTo": "https://takos.example.dev/ap/stores/official",
  "tkg:owner": "tako",
  "tkg:visibility": "public",
  "tkg:defaultBranch": "main",
  "tkg:cloneUrl": "https://takos.example.dev/git/tako/takos-computer.git",
  "tkg:browseUrl": "https://takos.example.dev/@tako/takos-computer",
  "tkg:branchesEndpoint": "https://takos.example.dev/@tako/takos-computer/branches",
  "tkg:commitsEndpoint": "https://takos.example.dev/@tako/takos-computer/commits",
  "tkg:treeUrlTemplate": "https://takos.example.dev/@tako/takos-computer/tree/{ref}/{+path}",
  "tkg:blobUrlTemplate": "https://takos.example.dev/@tako/takos-computer/blob/{ref}/{+path}",
  "tkg:refsEndpoint": "https://takos.example.dev/git/tako/takos-computer.git/info/refs?service=git-upload-pack"
}
```

| フィールド | 説明 |
| --- | --- |
| `type` | `["Document", "tkg:GitRepository"]` の配列 |
| `url` | ブラウズ用 URL (`/@{owner}/{repo}`) |
| `tkg:cloneUrl` | Git clone URL (`/git/{owner}/{repo}.git`) |
| `tkg:owner` | リポジトリの所有者 slug |
| `tkg:visibility` | `public` / `private` |
| `tkg:defaultBranch` | デフォルトブランチ名 |

個別リポジトリは `GET /ap/stores/{storeSlug}/repositories/{owner}/{repoName}` で取得できます。

---

## 5. Outbox

### リクエスト

```http
GET /ap/stores/{storeSlug}/outbox
GET /ap/stores/{storeSlug}/outbox?page=1&limit=20
```

### コレクション概要

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://takos.example.dev/ap/stores/official/outbox",
  "type": "OrderedCollection",
  "totalItems": 42,
  "first": "https://takos.example.dev/ap/stores/official/outbox?page=1"
}
```

### アクティビティ

Outbox は `Create` と `Update` のアクティビティを含みます。

- `updatedAt === createdAt` のリポジトリ → `Create` アクティビティ
- `updatedAt !== createdAt` のリポジトリ → `Update` アクティビティ

```json
{
  "id": "https://takos.example.dev/ap/stores/official/repositories/tako/takos-computer/activities/create/2026-01-15T10%3A00%3A00Z",
  "type": "Create",
  "actor": "https://takos.example.dev/ap/stores/official",
  "published": "2026-01-15T10:00:00Z",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "object": { "...": "完全な Repository オブジェクト" }
}
```

::: warning Delete アクティビティ
現在の実装では `Delete` アクティビティは生成されません。削除されたリポジトリはコレクションから消えますが、outbox に Delete が発行されることはありません。
:::

---

## 6. 検索

### Search Service

```http
GET /ap/stores/{storeSlug}/search
```

```json
{
  "id": "https://takos.example.dev/ap/stores/official/search",
  "type": ["Service", "tkg:SearchService"],
  "attributedTo": "https://takos.example.dev/ap/stores/official",
  "name": "official Search",
  "summary": "Search endpoints for the official store catalog",
  "tkg:repositorySearch": "https://takos.example.dev/ap/stores/official/search/repositories"
}
```

### リポジトリ検索

```http
GET /ap/stores/{storeSlug}/search/repositories?q={query}&page=1&limit=20&expand=object
```

`q` パラメータが必須です。リポジトリ名と説明に対する部分一致検索を行います。レスポンスは Repositories Collection と同じ `OrderedCollection` / `OrderedCollectionPage` 形式です。

---

## 7. Inbox (未実装)

```http
POST /ap/stores/{storeSlug}/inbox
```

常に 501 を返します。

```json
{
  "error": "not_implemented",
  "message": "Store inbox is not implemented. Use outbox polling for updates."
}
```

---

## 8. Followers (スタブ)

```http
GET /ap/stores/{storeSlug}/followers
```

常に空のコレクションを返します (`totalItems: 0`)。将来のフォロー機能のためのエンドポイントです。

---

## 9. `tkg` 名前空間

Takos は ActivityPub の標準語彙に加え、`tkg` (takos-git) 拡張名前空間を定義しています。

```http
GET /ns/takos-git
```

Content-Type: `application/ld+json; charset=utf-8`

定義される用語: `GitRepository`, `SearchService`, `repositories`, `search`, `repositorySearch`, `distributionMode`, `query`, `owner`, `visibility`, `defaultBranch`, `cloneUrl`, `browseUrl`, `branchesEndpoint`, `commitsEndpoint`, `treeUrlTemplate`, `blobUrlTemplate`, `refsEndpoint`

---

## 10. Store Registry API

Space にリモートの Store を登録・管理する API です。すべて認証が必要です。

### Store 登録

```http
POST /api/spaces/:spaceId/store-registry
```

```json
{
  "identifier": "official@takos.example.dev",
  "set_active": true,
  "subscribe": true
}
```

`identifier` は `{slug}@{domain}` 形式または ActivityPub Actor の完全 URL を受け付けます。

レスポンス (201):

```json
{
  "store": {
    "id": "sr_abc123",
    "actor_url": "https://takos.example.dev/ap/stores/official",
    "domain": "takos.example.dev",
    "store_slug": "official",
    "name": "Official Store",
    "summary": "Public repository catalog",
    "icon_url": "https://takos.example.dev/icon.png",
    "is_active": true,
    "subscription_enabled": true,
    "last_fetched_at": "2026-03-28T10:00:00Z",
    "created_at": "2026-03-28T10:00:00Z",
    "updated_at": "2026-03-28T10:00:00Z"
  }
}
```

### Store 一覧

```http
GET /api/spaces/:spaceId/store-registry
```

レスポンス: `{ "stores": [...] }`

### Store 更新

```http
PATCH /api/spaces/:spaceId/store-registry/:entryId
```

```json
{
  "is_active": true,
  "subscription_enabled": false
}
```

`is_active: true` を設定すると、他の Store は自動的に非アクティブになります。

### Store メタデータ再取得

```http
POST /api/spaces/:spaceId/store-registry/:entryId/refresh
```

リモート Actor を再 fetch し、name / summary / icon 等を更新します。

### Store 削除

```http
DELETE /api/spaces/:spaceId/store-registry/:entryId
```

レスポンス: `{ "success": true }`

### リモートリポジトリ閲覧

```http
GET /api/spaces/:spaceId/store-registry/:entryId/repositories?page=1&limit=20
```

リモート Store のリポジトリ一覧をプロキシ経由で取得します。

### リモートリポジトリ検索

```http
GET /api/spaces/:spaceId/store-registry/:entryId/repositories/search?q={query}&page=1&limit=20
```

---

## 11. リポジトリインストール

```http
POST /api/spaces/:spaceId/store-registry/:entryId/install
```

```json
{
  "remote_owner": "tako",
  "remote_repo_name": "takos-computer",
  "local_name": "my-takos-computer"
}
```

`local_name` は省略可能です。

レスポンス (201):

```json
{
  "repository": {
    "id": "repo_xyz789",
    "name": "my-takos-computer",
    "clone_url": "https://takos.example.dev/git/tako/takos-computer.git",
    "remote_store_actor_url": "https://takos.example.dev/ap/stores/official",
    "remote_browse_url": "https://takos.example.dev/@tako/takos-computer"
  }
}
```

---

## 12. サブスクリプション更新

Store の outbox をポーリングして更新を検出します。

### 手動ポーリング

```http
POST /api/spaces/:spaceId/store-registry/:entryId/poll
```

レスポンス: `{ "new_updates": 3 }`

### 更新一覧

```http
GET /api/spaces/:spaceId/store-registry/updates?unseen=true&limit=50&offset=0
```

```json
{
  "total": 3,
  "updates": [
    {
      "id": "upd_abc",
      "registry_entry_id": "sr_abc123",
      "store_name": "Official Store",
      "store_domain": "takos.example.dev",
      "activity_id": "https://takos.example.dev/ap/stores/official/repositories/tako/new-app/activities/create/...",
      "activity_type": "Create",
      "object_id": "https://takos.example.dev/ap/stores/official/repositories/tako/new-app",
      "object_type": "GitRepository",
      "object_name": "new-app",
      "object_summary": "New application template",
      "published": "2026-03-28T08:00:00Z",
      "seen": false,
      "created_at": "2026-03-28T08:30:00Z"
    }
  ]
}
```

### 既読マーク

```http
POST /api/spaces/:spaceId/store-registry/updates/mark-seen
```

```json
{
  "update_ids": ["upd_abc", "upd_def"]
}
```

`all: true` を渡すと全更新を既読にします。

レスポンス: `{ "success": true }`

---

## 13. Seed Repository との比較

| | Store | Seed Repository |
| --- | --- | --- |
| 用途 | 継続的なリポジトリ発見・配布 | space 初期化時の一度きりのクローン |
| 仕組み | ActivityPub outbox ポーリング | `GET /api/seed-repositories` |
| 更新検出 | outbox の activity stream | なし |
| インストール | Store Registry API | space 作成フロー内 |
| フェデレーション | あり (リモート Store を登録可能) | なし (同一インスタンスのみ) |

---

## 14. 制約と今後

- **inbox は未実装**: Store は pull-only。outbox ポーリングで更新を検出する
- **Delete アクティビティ非対応**: 削除されたリポジトリはコレクションから消えるが、Delete 通知は発行されない
- **followers はスタブ**: フォロー機能は将来対応
- **HTTP 署名は公開鍵のみ**: Actor の `publicKey` は公開するが、リクエスト署名検証は未実装
- **SSRF 保護**: リモート Store の fetch 時にプライベート IP / IPv6 / 内部 TLD (`.local`, `.internal`, `.localhost`) をブロック

---

## 15. エンドポイント一覧

### ActivityPub エンドポイント

| エンドポイント | メソッド | 説明 |
| --- | --- | --- |
| `/.well-known/webfinger` | GET | WebFinger 発見 |
| `/ap/stores/:store` | GET | Store Actor |
| `/ap/stores/:store/repositories` | GET | Repositories Collection |
| `/ap/stores/:store/repositories/:owner/:repo` | GET | 個別 Repository |
| `/ap/stores/:store/outbox` | GET | Outbox |
| `/ap/stores/:store/inbox` | POST | Inbox (501) |
| `/ap/stores/:store/followers` | GET | Followers (スタブ) |
| `/ap/stores/:store/search` | GET | Search Service |
| `/ap/stores/:store/search/repositories` | GET | リポジトリ検索 |
| `/ns/takos-git` | GET | `tkg` 名前空間定義 |

### Store Registry API

| エンドポイント | メソッド | 説明 |
| --- | --- | --- |
| `/api/spaces/:spaceId/store-registry` | GET | 登録済み Store 一覧 |
| `/api/spaces/:spaceId/store-registry` | POST | Store 登録 |
| `/api/spaces/:spaceId/store-registry/:entryId` | PATCH | Store 設定更新 |
| `/api/spaces/:spaceId/store-registry/:entryId` | DELETE | Store 削除 |
| `/api/spaces/:spaceId/store-registry/:entryId/refresh` | POST | メタデータ再取得 |
| `/api/spaces/:spaceId/store-registry/:entryId/repositories` | GET | リモートリポジトリ閲覧 |
| `/api/spaces/:spaceId/store-registry/:entryId/repositories/search` | GET | リモートリポジトリ検索 |
| `/api/spaces/:spaceId/store-registry/:entryId/install` | POST | リポジトリインストール |
| `/api/spaces/:spaceId/store-registry/:entryId/poll` | POST | 手動ポーリング |
| `/api/spaces/:spaceId/store-registry/updates` | GET | サブスクリプション更新一覧 |
| `/api/spaces/:spaceId/store-registry/updates/mark-seen` | POST | 既読マーク |
