# Store Network

> このページでわかること: 複数の Takos インスタンス間でアプリカタログを共有する仕組み。

Store Network は Takos インスタンス間で Store とリポジトリ参照を共有するための公開 API です。

## 目的

- ストアの公開メタデータを取得する
- リポジトリ参照を inventory / search で共有する
- inventory の追加・削除や、repo の push / tag / delete を feed として pull する
- リモートストアのリポジトリ参照をローカルワークスペースにインポートする

## Public API

| method | path                                                       | 説明                       |
| ------ | ---------------------------------------------------------- | -------------------------- |
| GET    | `/api/public/stores/:storeSlug`                            | ストアドキュメント         |
| GET    | `/api/public/stores/:storeSlug/inventory`                  | リポジトリ参照一覧         |
| GET    | `/api/public/stores/:storeSlug/inventory/:referenceId`     | リポジトリ参照             |
| GET    | `/api/public/stores/:storeSlug/search/repositories?q=term` | リポジトリ検索             |
| GET    | `/api/public/stores/:storeSlug/feed`                       | ストアフィード             |

## Repository Reference

```json
{
  "id": "repo-ref-1",
  "owner": "alice",
  "name": "demo",
  "summary": "Demo repo",
  "repository_url": "https://takos.example/@alice/demo",
  "clone_url": "https://takos.example/git/alice/demo.git",
  "browse_url": "https://takos.example/@alice/demo",
  "default_branch": "main",
  "default_branch_hash": "abc123",
  "source": "local",
  "created_at": "2026-03-01T00:00:00.000Z",
  "updated_at": "2026-03-02T00:00:00.000Z"
}
```

Public API は inbox / outbox / followers などのフェデレーション actor フィールドを公開しません。
`repository_url` は人間が開ける参照 URL、`clone_url` は Git Smart HTTP 用の clone URL です。

## リモートストアのインポート

リモートストアをレジストリに追加するときは `slug@domain` を渡します。

```json
{
  "identifier": "curated@store.example.com"
}
```

リポジトリのインポートでは、inventory / search で得た `id` または `repository_url` を
`repository_ref_url` として渡します。

```json
{
  "repository_ref_url": "https://store.example.com/@alice/demo",
  "local_name": "demo"
}
```

## フィード

フィードは pull 型です。Store registry が `/feed` を取得し、既存のイベント ID を除外して
未読のアップデートとして保存します。イベント種別は `inventory.add` / `inventory.remove` /
`repo.push` / `repo.tag` / `repo.delete` です。

```json
{
  "total": 1,
  "limit": 20,
  "offset": 0,
  "items": [
    {
      "id": "feed-1",
      "type": "repo.push",
      "published": "2026-03-03T00:00:00.000Z",
      "repository": {
        "id": "repo-ref-1",
        "owner": "alice",
        "name": "demo",
        "repository_url": "https://takos.example/@alice/demo",
        "clone_url": "https://takos.example/git/alice/demo.git"
      },
      "ref": "refs/heads/main",
      "before_hash": "abc123",
      "after_hash": "def456",
      "commit_count": 1,
      "commits": []
    }
  ]
}
