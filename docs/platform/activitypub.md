# ActivityPub Catalog Federation

Takos 互換の catalog app は **ActivityPub** と **ForgeFed** をベースとした Git
リポジトリの分散カタログを実装できます。git
データ本体は各インスタンスに分散したまま、リポジトリメタデータの発見・共有・購読を行います。

関連ドキュメント:

- [Store](/platform/store) — パッケージエコシステムの概念

---

## 概要

catalog app はリポジトリカタログとして機能します。git データの複製は行いません。

- **発見** — WebFinger と ActivityPub Actor によるリポジトリの発見
- **カタログ** — Inventory Collection による複数インスタンスの repo 参照の集約
- **検索** — リポジトリの全文検索
- **メタデータ共有** — commit / tag 情報の ActivityPub outbox での配信
- **購読** — Outbox polling による変更検出

---

## 設計原則

### git データは分散のまま

各インスタンスは自身の git データを保持する。 catalog app は git
データを持たず、リポジトリへの **参照** とメタデータのみを扱う。 clone / fetch /
push は常に canonical repo の `cloneUri` / `pushUri` に対して行う。

### catalog app はカタログ

`Store` actor はリポジトリの発見、購読、メタデータ共有を担当する。 inventory
は複数インスタンスにまたがるリポジトリ参照のコレクションである。

### 共有するのはメタデータ

インスタンス間で共有するのは以下のメタデータである。

- リポジトリの存在と基本情報 (名前, 説明, owner)
- commit メタデータ (SHA, message, author, date)
- tag 情報 (名前, 対象 commit)
- branch 一覧と default branch hash
- push イベント

git object data (blob, tree, packfile) は共有しない。

### Follow は購読だけ

`Follow` は outbox 更新を受け取るための購読である。 public な actor / collection
の GET に follow を要求してはならない。

### 非目標

- Git packfile / object data の複製・転送
- git データの CDN 的地理分散
- 複数インスタンス間の multi-master 書き込み

---

## 依存仕様

- [ActivityPub](https://www.w3.org/TR/activitypub/)
- [ActivityStreams 2.0](https://www.w3.org/TR/activitystreams-core/)
- [ForgeFed](https://forgefed.org/)

Takos 独自拡張は JSON-LD context (`https://takos.jp/ns#`) により追加する。 HTTP
Signature 用に `https://w3id.org/security/v1` context も使用する。

---

## Actor モデル

### Canonical Repository actor

canonical repo は ForgeFed `Repository` actor であり、git
データを保持する唯一の権威ソースである。

| フィールド          | 必須 | 説明                                                  |
| ------------------- | ---- | ----------------------------------------------------- |
| `id`                | Yes  | Actor URI                                             |
| `type`              | Yes  | `"Repository"`                                        |
| `name`              | Yes  | リポジトリ名                                          |
| `inbox`             | Yes  | ActivityPub inbox                                     |
| `outbox`            | Yes  | ActivityPub outbox                                    |
| `followers`         | Yes  | Followers collection                                  |
| `cloneUri`          | Yes  | Git clone URL の配列 (常にこの canonical repo を指す) |
| `pushUri`           |      | Git push URL の配列                                   |
| `summary`           |      | 説明                                                  |
| `url`               |      | ブラウズ用 URL (`/@{owner}/{repo}`)                   |
| `published`         |      | 作成日時                                              |
| `updated`           |      | 更新日時                                              |
| `stores`            |      | この repo を参照している Store の Collection URL      |
| `defaultBranchRef`  |      | `refs/heads/{branch}` 形式                            |
| `defaultBranchHash` |      | 既定ブランチの最新 commit hash                        |

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://forgefed.org/ns",
    "https://w3id.org/security/v1",
    {
      "takos": "https://takos.jp/ns#",
      "stores": { "@id": "takos:stores", "@type": "@id" },
      "defaultBranchRef": "takos:defaultBranchRef",
      "defaultBranchHash": "takos:defaultBranchHash"
    }
  ],
  "id": "https://a.example/ap/repos/alice/calc",
  "type": "Repository",
  "name": "calc",
  "summary": "Integer calculator",
  "url": "https://a.example/@alice/calc",
  "published": "2026-01-15T10:00:00Z",
  "updated": "2026-03-30T10:00:00Z",
  "inbox": "https://a.example/ap/repos/alice/calc/inbox",
  "outbox": "https://a.example/ap/repos/alice/calc/outbox",
  "followers": "https://a.example/ap/repos/alice/calc/followers",
  "cloneUri": ["https://a.example/git/alice/calc.git"],
  "pushUri": ["https://a.example/git/alice/calc.git"],
  "stores": "https://a.example/ap/repos/alice/calc/stores",
  "defaultBranchRef": "refs/heads/main",
  "defaultBranchHash": "4cc1f5b12a0f9c6d2db97e4f0ce4e98a1a0d9320"
}
```

### Store actor

`Store` actor はリポジトリカタログとして機能する。git データを保持しない。

| フィールド          | 必須 | 説明                                           |
| ------------------- | ---- | ---------------------------------------------- |
| `id`                | Yes  | Actor URI                                      |
| `type`              | Yes  | `["Service", "Store"]`                         |
| `name`              | Yes  | Store 名                                       |
| `inbox`             | Yes  | ActivityPub inbox                              |
| `outbox`            | Yes  | ActivityPub outbox                             |
| `followers`         | Yes  | Followers collection                           |
| `inventory`         | Yes  | リポジトリ参照の Collection URL                |
| `preferredUsername` |      | WebFinger 用 slug                              |
| `summary`           |      | 説明                                           |
| `url`               |      | Actor の canonical URL                         |
| `icon`              |      | Store の画像 (`{ type: "Image", url: "..." }`) |
| `publicKey`         |      | HTTP Signature 用公開鍵                        |
| `search`            |      | Search Service の URL                          |
| `repositorySearch`  |      | リポジトリ検索の直接 URL                       |

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://w3id.org/security/v1",
    {
      "takos": "https://takos.jp/ns#",
      "Store": "takos:Store",
      "inventory": { "@id": "takos:inventory", "@type": "@id" }
    }
  ],
  "id": "https://b.example/ap/stores/curated",
  "type": ["Service", "Store"],
  "name": "Curated Tools",
  "preferredUsername": "curated",
  "summary": "Curated collection of useful tools across instances",
  "url": "https://b.example/ap/stores/curated",
  "inbox": "https://b.example/ap/stores/curated/inbox",
  "outbox": "https://b.example/ap/stores/curated/outbox",
  "followers": "https://b.example/ap/stores/curated/followers",
  "inventory": "https://b.example/ap/stores/curated/inventory",
  "search": "https://b.example/ap/stores/curated/search",
  "repositorySearch": "https://b.example/ap/stores/curated/search/repositories",
  "publicKey": {
    "id": "https://b.example/ap/stores/curated#main-key",
    "owner": "https://b.example/ap/stores/curated",
    "publicKeyPem": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
  }
}
```

---

## コレクション

### inventory

Store actor の `inventory` は `OrderedCollection` で、canonical `Repository`
actor の URI を含む。同一インスタンスの repo と他インスタンスの repo
を混在できる。

**ハイブリッドモード:**

- 明示的な登録がない場合: アカウント内の全 public repo を自動列挙 (自動モード)
- 1件でも明示登録があれば: 登録されたリポジトリのみを表示 (明示モード)

inventory の管理 surface は catalog app ごとに持てます。Takos kernel 自体は
inventory の編集 API を標準化しません。

```json
{
  "id": "https://b.example/ap/stores/curated/inventory",
  "type": "OrderedCollection",
  "totalItems": 2,
  "orderedItems": [
    "https://a.example/ap/repos/alice/calc",
    "https://b.example/ap/repos/bob/tool"
  ]
}
```

### stores

canonical repo の `stores` は `OrderedCollection` で、この repo を inventory
に含む Store actor の URI を含む。

---

## メタデータ共有

### Push activity

canonical repo は push 成功後に ForgeFed `Push` activity を outbox に publish
する。 commit メタデータを含めてよい。

```json
{
  "type": "Push",
  "actor": "https://a.example/ap/repos/alice/calc",
  "attributedTo": "https://a.example/ap/users/alice",
  "target": "refs/heads/main",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "object": {
    "type": "OrderedCollection",
    "totalItems": 1,
    "orderedItems": [
      {
        "type": "Commit",
        "hash": "abc123def456",
        "message": "feat: add division operator",
        "attributedTo": { "name": "Alice", "email": "alice@example.com" },
        "committed": "2026-03-30T09:58:00Z"
      }
    ]
  }
}
```

### Tag activity

tag 作成時は `Create` activity で tag 情報を publish してよい。

```json
{
  "type": "Create",
  "actor": "https://a.example/ap/repos/alice/calc",
  "object": {
    "type": "Tag",
    "name": "v1.0.0",
    "ref": "refs/tags/v1.0.0",
    "target": "abc123...",
    "published": "2026-03-30T12:00:00Z"
  }
}
```

### Store での再配信

catalog app は購読している repo の activity を `Announce` で再配信してよい。
Store actor の follower は、Store actor をフォローすることで inventory 内の全
repo の活動を受け取れる。

---

## Activity rules

### canonical repo outbox

- `Create` : repo 生成時
- `Update` : summary, defaultBranchHash など変更時
- `Delete` : repo 削除時
- `Push` : push 成功時 (commit メタデータを含む)
- tag 関連の `Create` / `Delete`
- `Accept` / `Reject` : Follow への応答

### store outbox

明示モードの場合、Store outbox は実際の inventory 操作を activity
として記録する。 自動モードの場合は repo の Create/Update activity を生成する
(後方互換)。

- `Add` : 新しい repo 参照が inventory に追加された (明示モード)
- `Remove` : repo 参照が inventory から削除された (明示モード)
- `Announce` : inventory 内 repo の activity を再配信

---

## リポジトリ参照の管理

### 参照の追加

1. 管理者が Store の管理 API を通じて canonical repo の URI を指定する
2. Store は canonical repo の actor document を fetch してメタデータを取得する
3. Store は inventory に参照を追加する

### リモートインスタンスの repo を参照

1. 管理者がリモートインスタンスの repo URI を指定する
2. Store は ActivityPub fetch で actor document を取得する
3. `cloneUri`, `defaultBranchRef`, `defaultBranchHash` などを読み取る
4. inventory に参照として追加する
5. 必要なら canonical repo の outbox を定期的に polling して更新を検出する

---

## WebFinger 発見

```http
GET /.well-known/webfinger?resource=acct:{storeSlug}@{domain}
GET /.well-known/webfinger?resource=https://{domain}/ap/repos/{owner}/{repo}
```

Store は `acct:` URI 形式、Repository は Actor URL 形式で解決できる。

---

## 可視性と access control

### public read

public repo / store について、以下は **follow なし** で GET
可能でなければならない。

- actor document
- public outbox page
- stores / inventory collection

### Follow

- `Follow` を inbox に POST すると `Accept` が返り、followers に追加される
- `Undo` + `Follow` で unfollow
- `Follow` は購読であり、認可ではない
- `Store` への `Follow` は inventory 変化の通知購読を意味する
- `Repository` への `Follow` は Push activity の通知購読を意味する

### capability / Grant

- private repo のメタデータを Store が参照する場合、`visit` Grant が必要
- push 権限は `write` 以上の Grant でなければならない
- Grant は canonical repo に対して発行する

---

## `takos:` 名前空間

```http
GET /ns/takos
```

```json
{
  "@context": {
    "takos": "https://takos.jp/ns#",
    "Store": "takos:Store",
    "inventory": { "@id": "takos:inventory", "@type": "@id" },
    "stores": { "@id": "takos:stores", "@type": "@id" },
    "defaultBranchRef": "takos:defaultBranchRef",
    "defaultBranchHash": "takos:defaultBranchHash"
  }
}
```

::: info 旧エンドポイント `/ns/takos-git` は `/ns/takos` へ 301
リダイレクトします。 :::

---

## クライアント利用フロー

1. Store の inventory または検索で目的の repo を発見する
2. repo の actor document を取得する
3. `cloneUri` を使って canonical repo から直接 `git clone` する

Store は発見の手段であり、git データの取得先ではない。

---

## セキュリティ要件

1. 受信 activity の actor なりすましを検証しなければならない (HTTP Signature 必須、署名なし or 検証失敗で 401)
2. push は capability と Git 認証の両方を検証すべきである
3. public GET を許可する場合でも rate limit を設けるべきである
4. private repo のメタデータを Store が参照する場合、`visit` Grant
   の範囲を最小化すべきである
5. リモート Store fetch 時にプライベート IP / IPv6 / 内部 TLD をブロックする
   (SSRF 保護)

### HTTP Signature

inbound activity の verification は **strict mode**:

- algorithm: **RSA-SHA256 (RFC 8017)**、Cavage draft (`draft-cavage-http-signatures-12`) compatible
- headers: `(request-target) host date digest`
- keyId format: `{actor-url}#main-key`
- signature header **必須**。欠落 or 検証失敗で 401 reject。

#### Replay 保護

Cavage §2.1.2 と Mastodon の慣行に合わせて、inbox は以下の replay 保護を追加で行う:

1. **`Date` header skew check** — `Date` が無い、parse できない、現在時刻 ±5 分を超える場合は 401 reject
2. **Activity id dedup** — verification 後に `body.id` を bounded な in-memory set に記録 (worker instance ごと、最大 2,048 件、TTL 20 分)。同じ activity id の再 delivery は 200 を返して再処理しない (`{ duplicate: true }`)
3. **Actor public-key cache** — `keyId` で fetch した actor document は **24 時間** in-memory にキャッシュ (worker instance ごと、最大 512 entries)。同じ remote actor からの burst で N 回 `apFetch` が走るのを防ぐ

cache はすべて process-local なので CF Worker の cold start で flush される。クロスインスタンス共有が必要なら routing KV / D1 に promote すること。

#### 配信側

outbound delivery は `PLATFORM_PRIVATE_KEY` env が設定されている場合に署名付きで delivery、未設定時は warning ログを残して unsigned で best-effort 配信。`Repository` actor (`buildRepoActor`) も自身の `publicKey` を公開するため、他サーバーから signed delivery を受け取って verify できる。

::: warning Delivery retry
現状、`deliverToFollowers` は **one-shot `Promise.allSettled`** で、失敗時の **retry / backoff / DLQ は未実装**。配送先が一時的に down している場合 activity は失われる。kernel の cron / queue ベースの delivery queue が必要 (Round 11 audit ActivityPub finding #4)。
:::

::: tip repo_push_activities retention
`repo_push_activities` table は現状 GC されません。busy repo では数万行に達して
outbox pagination が遅くなる可能性があります。retention policy は未定で、
operator が必要に応じて DB 直接クリーンアップする想定です。将来的には kernel
の hourly cron で `repo_id` ごとに直近 N 件 (e.g. 500 件) 残してそれ以前を
削除する batch を追加予定。
:::

---

## 互換性

- Store を知らないクライアントでも、canonical repo は通常の ForgeFed
  `Repository` として読める
- `Store` は `Service` を兼ねるため、非対応実装でも actor として最低限扱える
- git 転送は `cloneUri` / `pushUri` に残すため、ActivityPub
  経由で大きなデータを流さない
- inventory の item は canonical repo の URI なので、Store
  非対応のクライアントでも直接 repo にアクセスできる

---

## Store Registry API

Space にリモートの Store を登録・管理する API。すべて認証が必要。

| エンドポイント                                                     | メソッド | 説明                       |
| ------------------------------------------------------------------ | -------- | -------------------------- |
| `/api/spaces/:spaceId/store-registry`                              | GET      | 登録済み Store 一覧        |
| `/api/spaces/:spaceId/store-registry`                              | POST     | Store 登録                 |
| `/api/spaces/:spaceId/store-registry/:entryId`                     | PATCH    | Store 設定更新             |
| `/api/spaces/:spaceId/store-registry/:entryId`                     | DELETE   | Store 削除                 |
| `/api/spaces/:spaceId/store-registry/:entryId/refresh`             | POST     | メタデータ再取得           |
| `/api/spaces/:spaceId/store-registry/:entryId/repositories`        | GET      | リモートリポジトリ閲覧     |
| `/api/spaces/:spaceId/store-registry/:entryId/repositories/search` | GET      | リモートリポジトリ検索     |
| `/api/spaces/:spaceId/store-registry/:entryId/import-repository`   | POST     | リポジトリ参照の import    |
| `/api/spaces/:spaceId/store-registry/:entryId/poll`                | POST     | 手動ポーリング             |
| `/api/spaces/:spaceId/store-registry/updates`                      | GET      | サブスクリプション更新一覧 |
| `/api/spaces/:spaceId/store-registry/updates/mark-seen`            | POST     | 既読マーク                 |

---

## エンドポイント一覧

### ActivityPub

| エンドポイント                          | メソッド | 説明                              |
| --------------------------------------- | -------- | --------------------------------- |
| `/.well-known/webfinger`                | GET      | WebFinger 発見 (Store + Repo)     |
| `/ns/takos`                             | GET      | `takos:` 名前空間定義             |
| `/ap/stores/:store`                     | GET      | Store Actor (カタログ)            |
| `/ap/stores/:store/inventory`           | GET      | Inventory (repo 参照コレクション) |
| `/ap/stores/:store/outbox`              | GET      | Store Outbox                      |
| `/ap/stores/:store/inbox`               | POST     | Store Inbox (Follow/Undo)         |
| `/ap/stores/:store/followers`           | GET      | Store Followers                   |
| `/ap/stores/:store/search`              | GET      | Search Service                    |
| `/ap/stores/:store/search/repositories` | GET      | リポジトリ検索                    |
| `/ap/repos/:owner/:repo`                | GET      | Canonical Repository Actor        |
| `/ap/repos/:owner/:repo/inbox`          | POST     | Repo Inbox (Follow/Undo)          |
| `/ap/repos/:owner/:repo/outbox`         | GET      | Repo Outbox (Push activities)     |
| `/ap/repos/:owner/:repo/followers`      | GET      | Repo Followers                    |
| `/ap/repos/:owner/:repo/stores`         | GET      | Stores Collection                 |

### 後方互換リダイレクト

| 旧                                            | 新                            |
| --------------------------------------------- | ----------------------------- |
| `/ns/takos-git`                               | `/ns/takos`                   |
| `/ap/stores/:store/repositories`              | `/ap/stores/:store/inventory` |
| `/ap/stores/:store/repositories/:owner/:repo` | `/ap/repos/:owner/:repo`      |

---

## URI 推奨パターン

### Canonical repo

- Actor: `/ap/repos/{owner}/{repo}`
- Git clone: `/git/{owner}/{repo}.git`

### Store

- Actor: `/ap/stores/{storeId}`
- Inventory: `/ap/stores/{storeId}/inventory`
