# ActivityPub Store 仕様

Revision: 2026-03-26 r1
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
- **更新通知 (Notification)** — Outbox のアクティビティストリームによる変更の配信
- **インストール (Installation)** — リモートストアからのリポジトリインストール

### 設計原則

1. **Pull-only** — Store は outbox を公開するのみ。inbox は未実装 (501 を返す)
2. **ActivityPub 互換** — 標準の ActivityPub / ActivityStreams 2.0 語彙を使用
3. **WebFinger 発見** — 標準のリソース発見プロトコルに従う
4. **既存の Git インフラを活用** — リポジトリの実体は Git リポジトリ

### Store と Seed repositories の違い

Takos にはリポジトリを取得する仕組みが 2 つ存在します。

| | Store | Seed repositories |
| --- | --- | --- |
| 目的 | リポジトリの**発見と配布** | Space の**初回セットアップ** |
| プロトコル | ActivityPub フェデレーション | 単純な URL 配列 |
| 発見 | WebFinger → Actor → Collection | 設定ファイルに直接記述 |
| 更新通知 | Outbox ポーリング | なし (一度きり) |
| ライフサイクル | 継続的 (ストアレジストリに登録) | 初回のみ (Space 作成時) |
| 依存関係 | Store と独立して動作 | Store と独立して動作 |

**Store** はフェデレーション可能な発見の仕組みであり、**Seed** は初回セットアップ時に Space にリポジトリをクローンするための仕組みです。両者は独立しており、Seed は Store を経由しません。

---

## 2. WebFinger 発見フロー

Store の発見は WebFinger (RFC 7033) から始まります。

### リクエスト

```http
GET /.well-known/webfinger?resource=acct:store-slug@takos.example.dev
Host: takos.example.dev
Accept: application/jrd+json
```

### レスポンス

```json
{
  "subject": "acct:store-slug@takos.example.dev",
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://takos.example.dev/ap/stores/store-slug"
    }
  ]
}
```

クライアントは `rel=self` かつ `type=application/activity+json` のリンクを取得し、Store Actor の URL を得ます。

### 発見フロー全体

```
┌──────────┐     ┌──────────────────────┐
│  Client  │     │  Remote Takos        │
│          │     │  Instance            │
└────┬─────┘     └──────────┬───────────┘
     │                      │
     │  1. GET /.well-known/webfinger
     │     ?resource=acct:store@remote.dev
     │─────────────────────>│
     │                      │
     │  2. JRD (Actor URL)  │
     │<─────────────────────│
     │                      │
     │  3. GET /ap/stores/{slug}
     │     Accept: application/activity+json
     │─────────────────────>│
     │                      │
     │  4. Actor document   │
     │<─────────────────────│
     │                      │
     │  5. GET /ap/stores/{slug}/repositories
     │     Accept: application/activity+json
     │─────────────────────>│
     │                      │
     │  6. OrderedCollection│
     │     (リポジトリ一覧)  │
     │<─────────────────────│
     └──────────────────────┘
```

---

## 3. Store Actor

Store Actor は ActivityPub の `Service` 型 Actor です。

### エンドポイント

```
GET /ap/stores/{slug}
Accept: application/activity+json
```

### レスポンス

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1"
  ],
  "id": "https://takos.example.dev/ap/stores/official",
  "type": "Service",
  "name": "Official Takos Store",
  "summary": "Takos 公式パッケージリポジトリ",
  "preferredUsername": "official",
  "inbox": "https://takos.example.dev/ap/stores/official/inbox",
  "outbox": "https://takos.example.dev/ap/stores/official/outbox",
  "url": "https://takos.example.dev/ap/stores/official",
  "published": "2026-01-15T00:00:00Z",
  "endpoints": {
    "repositories": "https://takos.example.dev/ap/stores/official/repositories"
  },
  "publicKey": {
    "id": "https://takos.example.dev/ap/stores/official#main-key",
    "owner": "https://takos.example.dev/ap/stores/official",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  }
}
```

### Actor フィールド

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | string | Actor の一意な URI |
| `type` | string | `Service` 固定 |
| `name` | string | Store の表示名 |
| `summary` | string | Store の説明 |
| `preferredUsername` | string | Store の slug |
| `inbox` | string | Inbox URL (501 を返す) |
| `outbox` | string | Outbox URL |
| `endpoints.repositories` | string | Repositories Collection の URL |
| `publicKey` | object | HTTP Signatures 用の公開鍵 |

---

## 4. Repositories Collection

Store が公開するリポジトリの一覧を `OrderedCollection` として提供します。

### エンドポイント

```
GET /ap/stores/{slug}/repositories
Accept: application/activity+json
```

### レスポンス

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://takos.example.dev/ap/stores/official/repositories",
  "type": "OrderedCollection",
  "totalItems": 3,
  "orderedItems": [
    {
      "type": "Object",
      "id": "https://takos.example.dev/ap/stores/official/repositories/takos-computer",
      "name": "takos-computer",
      "summary": "Browser automation and agent executor",
      "url": "https://takos.example.dev/git/stores/official/takos-computer.git",
      "published": "2026-02-01T00:00:00Z",
      "updated": "2026-03-20T12:00:00Z",
      "tag": [
        { "type": "Hashtag", "name": "browser" },
        { "type": "Hashtag", "name": "agent" },
        { "type": "Hashtag", "name": "playwright" }
      ],
      "attachment": [
        {
          "type": "PropertyValue",
          "name": "version",
          "value": "1.0.0"
        },
        {
          "type": "PropertyValue",
          "name": "category",
          "value": "service"
        }
      ]
    },
    {
      "type": "Object",
      "id": "https://takos.example.dev/ap/stores/official/repositories/memo-agent",
      "name": "memo-agent",
      "summary": "Memory management agent with RAG",
      "url": "https://takos.example.dev/git/stores/official/memo-agent.git",
      "published": "2026-02-15T00:00:00Z",
      "updated": "2026-03-18T09:00:00Z",
      "tag": [
        { "type": "Hashtag", "name": "memory" },
        { "type": "Hashtag", "name": "rag" }
      ],
      "attachment": [
        {
          "type": "PropertyValue",
          "name": "version",
          "value": "0.5.0"
        },
        {
          "type": "PropertyValue",
          "name": "category",
          "value": "tool"
        }
      ]
    }
  ]
}
```

### リポジトリオブジェクトのフィールド

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | string | リポジトリの一意な URI |
| `name` | string | リポジトリ名 |
| `summary` | string | 説明 |
| `url` | string | Git clone 用 URL |
| `published` | string | 初回公開日時 (ISO 8601) |
| `updated` | string | 最終更新日時 (ISO 8601) |
| `tag` | array | カテゴリ・検索用タグ |
| `attachment` | array | バージョン等のメタデータ (`PropertyValue`) |

### ページネーション

リポジトリ数が多い場合、`OrderedCollectionPage` によるページネーションが使われます。

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://takos.example.dev/ap/stores/official/repositories",
  "type": "OrderedCollection",
  "totalItems": 150,
  "first": "https://takos.example.dev/ap/stores/official/repositories?page=1",
  "last": "https://takos.example.dev/ap/stores/official/repositories?page=8"
}
```

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://takos.example.dev/ap/stores/official/repositories?page=1",
  "type": "OrderedCollectionPage",
  "partOf": "https://takos.example.dev/ap/stores/official/repositories",
  "next": "https://takos.example.dev/ap/stores/official/repositories?page=2",
  "orderedItems": [
    { "..." : "..." }
  ]
}
```

---

## 5. Outbox — アクティビティストリーム

Store の outbox はリポジトリの追加・更新・削除のアクティビティを時系列で公開します。

### エンドポイント

```
GET /ap/stores/{slug}/outbox
Accept: application/activity+json
```

### レスポンス

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://takos.example.dev/ap/stores/official/outbox",
  "type": "OrderedCollection",
  "totalItems": 42,
  "first": "https://takos.example.dev/ap/stores/official/outbox?page=1"
}
```

### アクティビティページ

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "id": "https://takos.example.dev/ap/stores/official/outbox?page=1",
  "type": "OrderedCollectionPage",
  "partOf": "https://takos.example.dev/ap/stores/official/outbox",
  "orderedItems": [
    {
      "type": "Update",
      "id": "https://takos.example.dev/ap/stores/official/outbox/act-003",
      "actor": "https://takos.example.dev/ap/stores/official",
      "object": {
        "type": "Object",
        "id": "https://takos.example.dev/ap/stores/official/repositories/takos-computer",
        "name": "takos-computer",
        "attachment": [
          {
            "type": "PropertyValue",
            "name": "version",
            "value": "1.1.0"
          }
        ]
      },
      "published": "2026-03-25T15:00:00Z",
      "summary": "takos-computer を v1.1.0 に更新"
    },
    {
      "type": "Create",
      "id": "https://takos.example.dev/ap/stores/official/outbox/act-002",
      "actor": "https://takos.example.dev/ap/stores/official",
      "object": {
        "type": "Object",
        "id": "https://takos.example.dev/ap/stores/official/repositories/memo-agent",
        "name": "memo-agent",
        "url": "https://takos.example.dev/git/stores/official/memo-agent.git"
      },
      "published": "2026-02-15T00:00:00Z",
      "summary": "memo-agent を追加"
    },
    {
      "type": "Delete",
      "id": "https://takos.example.dev/ap/stores/official/outbox/act-001",
      "actor": "https://takos.example.dev/ap/stores/official",
      "object": "https://takos.example.dev/ap/stores/official/repositories/deprecated-tool",
      "published": "2026-02-10T00:00:00Z",
      "summary": "deprecated-tool を削除"
    }
  ]
}
```

### アクティビティタイプ

| タイプ | 説明 |
| --- | --- |
| `Create` | 新しいリポジトリの追加 |
| `Update` | 既存リポジトリの更新 (バージョン更新等) |
| `Delete` | リポジトリの削除 |

---

## 6. リモートストア登録

Space にリモートの Store を登録するには、Store Registry API を使用します。

### ストアの登録

```http
POST /api/spaces/:space_id/store-registry
Content-Type: application/json
Authorization: Bearer <token>

{
  "url": "https://remote.takos.dev/ap/stores/official",
  "name": "Remote Official Store"
}
```

サーバーは以下の手順で Store を検証・登録します。

1. 指定された URL に `Accept: application/activity+json` で GET リクエスト
2. レスポンスが有効な ActivityPub `Service` Actor であることを検証
3. `outbox` と `endpoints.repositories` の URL を取得
4. Store Registry に登録

### レスポンス

```json
{
  "id": "store_reg_abc123",
  "space_id": "space_xyz",
  "actor_url": "https://remote.takos.dev/ap/stores/official",
  "name": "Remote Official Store",
  "repositories_url": "https://remote.takos.dev/ap/stores/official/repositories",
  "outbox_url": "https://remote.takos.dev/ap/stores/official/outbox",
  "last_synced_at": null,
  "created_at": "2026-03-26T10:00:00Z"
}
```

### 登録済みストアの一覧

```http
GET /api/spaces/:space_id/store-registry
Authorization: Bearer <token>
```

```json
{
  "stores": [
    {
      "id": "store_reg_abc123",
      "actor_url": "https://remote.takos.dev/ap/stores/official",
      "name": "Remote Official Store",
      "repository_count": 12,
      "last_synced_at": "2026-03-26T12:00:00Z",
      "created_at": "2026-03-26T10:00:00Z"
    }
  ]
}
```

### ストアの削除

```http
DELETE /api/spaces/:space_id/store-registry/:store_reg_id
Authorization: Bearer <token>
```

ストアを削除しても、既にインストール済みのリポジトリには影響しません。

---

## 7. Subscription — Outbox ポーリングによる更新通知

登録済み Store の更新はバックグラウンドの outbox ポーリングで検出されます。

### ポーリングの仕組み

```
┌──────────────────┐     ┌──────────────────────┐
│  Takos Instance  │     │  Remote Store        │
│  (subscriber)    │     │  (publisher)         │
└────────┬─────────┘     └──────────┬───────────┘
         │                          │
         │  定期的に GET outbox      │
         │─────────────────────────>│
         │                          │
         │  OrderedCollection       │
         │  (新規アクティビティ)      │
         │<─────────────────────────│
         │                          │
         │  last_synced_at 以降の    │
         │  アクティビティを処理      │
         │                          │
         │  ローカルのリポジトリ      │
         │  メタデータを更新         │
         └──────────────────────────┘
```

### ポーリングの動作

1. 登録済み Store ごとに `last_synced_at` を記録
2. 定期的に outbox を取得し、`last_synced_at` 以降の新しいアクティビティを抽出
3. `Create` — ローカルのリポジトリ一覧に追加
4. `Update` — ローカルのリポジトリメタデータを更新
5. `Delete` — ローカルのリポジトリ一覧から削除
6. `last_synced_at` を更新

::: info Pull-only アーキテクチャ
Store は inbox を実装していないため、リモートインスタンスからの push 通知は受け付けません。
すべての更新検出は subscriber 側の outbox ポーリングに依存します。
:::

---

## 8. リポジトリインストール

Store Registry からリポジトリを Space にインストールします。

### インストールリクエスト

```http
POST /api/spaces/:space_id/store-registry/:store_reg_id/install
Content-Type: application/json
Authorization: Bearer <token>

{
  "repository": "takos-computer",
  "ref": "main"
}
```

### インストール処理

```
┌──────────┐     ┌──────────────┐     ┌──────────────────┐
│  Client  │     │  Takos API   │     │  Remote Store    │
└────┬─────┘     └──────┬───────┘     └────────┬─────────┘
     │                  │                      │
     │  1. POST install │                      │
     │─────────────────>│                      │
     │                  │                      │
     │                  │  2. Repositories Collection
     │                  │     からリポジトリ情報を取得
     │                  │─────────────────────>│
     │                  │                      │
     │                  │  3. Git clone URL を  │
     │                  │     取得              │
     │                  │<─────────────────────│
     │                  │                      │
     │                  │  4. git clone で      │
     │                  │     リポジトリを取得    │
     │                  │─────────────────────>│
     │                  │                      │
     │                  │  5. Space 内に        │
     │                  │     リポジトリを作成    │
     │                  │                      │
     │  6. 201 Created  │                      │
     │<─────────────────│                      │
     └──────────────────┴──────────────────────┘
```

### レスポンス

```json
{
  "id": "repo_new123",
  "space_id": "space_xyz",
  "name": "takos-computer",
  "source": {
    "store_registry_id": "store_reg_abc123",
    "actor_url": "https://remote.takos.dev/ap/stores/official",
    "repository_id": "takos-computer",
    "ref": "main",
    "installed_at": "2026-03-26T10:30:00Z"
  },
  "created_at": "2026-03-26T10:30:00Z"
}
```

### インストール後

- リポジトリは Space 内の通常のリポジトリとして扱われる
- インストール元の Store との紐付けは `source` フィールドに記録される
- インストール後の更新は自動では反映されない (手動で再インストールが必要)

---

## 9. Seed repositories との詳細比較

### Seed repositories

Seed は Space 作成時にリポジトリを初期配置するための仕組みです。

```json
{
  "seed_repositories": [
    "https://github.com/example/repo-a.git",
    "https://github.com/example/repo-b.git"
  ]
}
```

- 単純な Git URL の配列
- Space 作成時に 1 回だけクローンされる
- Store Registry とは完全に独立
- フェデレーションや発見の仕組みはない
- メタデータ (バージョン、タグ等) の管理はない

### Store

Store は継続的なリポジトリ発見・配布の仕組みです。

- ActivityPub フェデレーションに基づく発見
- WebFinger による標準的なリソース解決
- メタデータの構造化 (バージョン、カテゴリ、タグ)
- Outbox による更新通知
- Store Registry による登録管理

### 使い分け

| ユースケース | 推奨 |
| --- | --- |
| テンプレートから Space を作成 | Seed |
| チーム内の標準リポジトリを配布 | Store |
| 外部のパッケージを発見・導入 | Store |
| CI/CD で Space を自動セットアップ | Seed |
| フェデレーションでリポジトリを共有 | Store |

---

## 10. 制約と今後

### Inbox は未実装

Store Actor の `inbox` エンドポイントは ActivityPub の仕様上は必須フィールドですが、Takos の現在の実装では **501 Not Implemented** を返します。

```http
POST /ap/stores/{slug}/inbox
Content-Type: application/activity+json

→ 501 Not Implemented
```

```json
{
  "error": "Store inbox is not implemented. This store is pull-only; use outbox polling for updates.",
  "code": "NOT_IMPLEMENTED"
}
```

これは設計上の判断であり、Store は **pull-only** のアーキテクチャを採用しています。

- リモートからの `Follow` / `Undo` アクティビティは受け付けない
- 更新の検出はすべて subscriber 側の outbox ポーリングに依存
- push 通知が必要になった場合は将来のバージョンで検討

### その他の制約

| 制約 | 説明 |
| --- | --- |
| 認証 | Store の公開エンドポイント (`/ap/stores/...`) は認証不要。API エンドポイント (`/api/spaces/...`) は Bearer token が必要 |
| レート制限 | Outbox ポーリングにはレート制限が適用される |
| プライベート Store | 現時点では Store はすべて公開。プライベート Store は将来対応 |
| 署名検証 | HTTP Signatures による署名は Store → 外部への outgoing リクエストのみ。incoming の署名検証は inbox 未実装のため不要 |
