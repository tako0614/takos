# Store Network

Store Network は Takos instance 間で Store と repository 参照を共有するための
公開 JSON API です。protocol は REST v1 で、remote store は
`slug@domain` または `https://domain/api/public/stores/:slug` として参照する。

## 目的

- store の公開 metadata を取得する
- repository reference を inventory / search で共有する
- inventory 追加・削除、repo push / tag / delete を feed として pull する
- remote store の repository reference を local workspace に import する

## Public API

| method | path                                                       | description               |
| ------ | ---------------------------------------------------------- | ------------------------- |
| GET    | `/api/public/stores/:storeSlug`                            | store document            |
| GET    | `/api/public/stores/:storeSlug/inventory`                  | repository reference list |
| GET    | `/api/public/stores/:storeSlug/inventory/:referenceId`     | repository reference      |
| GET    | `/api/public/stores/:storeSlug/search/repositories?q=term` | repository search         |
| GET    | `/api/public/stores/:storeSlug/feed`                       | store feed                |

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

Public API は inbox / outbox / followers などの federation actor field
を公開しない。`repository_url` は人間が開ける canonical reference、
`clone_url` は Git Smart HTTP 用の clone URL。

## Remote Store Import

Remote store を registry に追加するときは `slug@domain` を渡す。

```json
{
  "identifier": "curated@store.example.com"
}
```

Repository import は inventory / search で得た `id` または `repository_url`
を `repository_ref_url` として渡す。

```json
{
  "repository_ref_url": "https://store.example.com/@alice/demo",
  "local_name": "demo"
}
```

## Feed

Feed は pull 型。Store registry は `/feed` を取得し、既存の event id
を除外して未読 update として保存する。event type は `inventory.add`,
`inventory.remove`, `repo.push`, `repo.tag`, `repo.delete`。

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
