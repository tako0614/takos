# File Handlers

> このページでわかること: ファイルタイプに応じてアプリで開く仕組み。

File handler はストレージ UI からファイルを対応アプリで開くための仕組みです。

## AppSpec

handler UI 自体は普通の HTTP workload として deploy します。

```yaml
apiVersion: v1
metadata:
  id: com.example.docs-handler
  name: Docs Handler
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    spec:
      routes:
        - docs.example.com/*
```

Takosumi installer は `.takosumi.yml` から build output と route を解決して
Deployment record を作ります。ユーザー向け AppSpec に compiled artifact
placeholder は書きません。

> Wave J で AppSpec から top-level `interfaces:` / `permissions:` / `routes:`
> field を物理削除しました。 launcher endpoint は worker materializer convention
> (= `spec.routes` の HTTP path) と Takos product 内部 metadata layer
> (= app launcher registry、 AppSpec contract とは別) で表現します。

## App Metadata

Storage UI に handler として見せる情報は app metadata / registry entry として 管理します。metadata は deploy 後の
resource output を参照できます。

```yaml
fileHandlers:
  - name: markdown
    title: Markdown
    url: ${ref:web.url}/files/:id
    mimeTypes: [text/markdown]
    extensions: [.md]
```

`url` の `:id` は URL encode された file ID に置換されます。`:id` は path segment として必須です。storage UI
は起動時に `space_id` query parameter も付けます。

この metadata は `.takosumi.yml` AppSpec の component schema ではありません。App metadata、Takos app
catalog、または runtime registration が Storage の file handler registry に materialize します。

## 複数ハンドラー

同じ app は複数 handler を登録できます。

```yaml
fileHandlers:
  - name: markdown
    title: Markdown
    url: ${ref:web.url}/files/:id
    mimeTypes: [text/markdown]
    extensions: [.md]
  - name: image
    title: Images
    url: ${ref:web.url}/viewer/:id
    mimeTypes: [image/png, image/jpeg, image/gif]
    extensions: [.png, .jpg, .jpeg, .gif]
```

metadata 内で handler name は app installation 内一意にします。

## フィールド

| field        | required    | 説明                                            |
| ------------ | ----------- | ----------------------------------------------- |
| `name`       | yes         | handler の stable name                          |
| `title`      | no          | UI 表示名。省略時は `name`                      |
| `url`        | yes         | handler URL template。`:id` path segment が必須 |
| `mimeTypes`  | conditional | 対応する MIME type のリスト                     |
| `extensions` | conditional | 対応するファイル拡張子のリスト                  |

`mimeTypes` と `extensions` は少なくとも一方が必須です。両方を指定することも できます。

## Discovery API Selection Ranking

`GET /api/spaces/:spaceId/storage/file-handlers?mime=...&ext=...` で複数の handler が match した場合、以下の order で
sort されます。

| rank | 条件                             |
| ---- | -------------------------------- |
| 0    | mime + ext 両方が exact match    |
| 1    | mime のみ match (ext 不問)       |
| 2    | extension のみ match (mime 不問) |
| 3    | filter 無し (no params)          |

同 rank 内では registry 登録順で tie-break します。

## 次のステップ

- [MCP Server](/apps/mcp) --- MCP Server の公開方法
- [App Integration Metadata Boundary](/architecture/app-publications)
- [Deploy Manifest](/deploy/manifest) --- `.takosumi.yml` の全体像
