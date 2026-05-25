# File Handlers

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

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
    spec:
      entrypoint: src/worker.ts
    publish:
      http:
        as: http-endpoint
  public:
    kind: gateway
    listen:
      upstream:
        from: web.http
        as: upstream
    publish:
      public:
        as: http-endpoint
    spec:
      listeners:
        public:
          protocol: https
          host: docs.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

Takosumi installer は `.takosumi.yml` から gateway descriptor spec と source file
reference を解決して Deployment record を作ります。build が必要な source は
prepared source snapshot として Installer API に渡します。

launcher endpoint は gateway descriptor spec と Takos product 内部 metadata layer (= app launcher registry、AppSpec
contract とは別) で表現します。

## App Metadata

Storage UI に handler として見せる情報は app metadata / registry entry として管理します。metadata は deploy 後の
resource output を参照できます。

```yaml
fileHandlers:
  - name: markdown
    title: Markdown
    endpoint:
      from: public.public
      pathTemplate: /files/:id
    mimeTypes: [text/markdown]
    extensions: [.md]
```

`endpoint.pathTemplate` の `:id` は URL encode された file ID に置換されます。 `:id` は path segment
として必須です。storage UI は起動時に `space_id` query parameter も付けます。

この metadata は App metadata、Takos app catalog、または runtime registration に
置き、Storage の file handler registry に materialize します。

## 複数ハンドラー

同じ app は複数 handler を登録できます。

```yaml
fileHandlers:
  - name: markdown
    title: Markdown
    endpoint:
      from: public.public
      pathTemplate: /files/:id
    mimeTypes: [text/markdown]
    extensions: [.md]
  - name: image
    title: Images
    endpoint:
      from: public.public
      pathTemplate: /viewer/:id
    mimeTypes: [image/png, image/jpeg, image/gif]
    extensions: [.png, .jpg, .jpeg, .gif]
```

metadata 内で handler name は app installation 内一意にします。

## フィールド

| field        | required    | 説明                                                                           |
| ------------ | ----------- | ------------------------------------------------------------------------------ |
| `name`       | yes         | handler の stable name                                                         |
| `title`      | no          | UI 表示名。省略時は `name`                                                     |
| `endpoint`   | yes         | Deployment output reference + handler path template。`:id` path segment が必須 |
| `mimeTypes`  | conditional | 対応する MIME type のリスト                                                    |
| `extensions` | conditional | 対応するファイル拡張子のリスト                                                 |

`mimeTypes` と `extensions` は少なくとも一方が必須です。両方を指定することもできます。

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
- [Takos AppSpec examples](/deploy/manifest) --- 全体像
