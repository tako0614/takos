# File Handlers

特定の MIME type や拡張子のファイルを handler UI で開けるようにするには
`publications[]` に `publication.file-handler@v1` ref の publication を
declaration します。

## 基本

```yaml
components:
  web:
    contracts:
      runtime: { ref: runtime.js-worker@v1, config: { source: { ... } } }
      ui: { ref: interface.http@v1 }

routes:
  - id: file-open
    expose: { component: web, contract: ui }
    via: { ref: route.https@v1, config: { path: /files/:id } }

publications:
  - name: markdown
    ref: publication.file-handler@v1
    outputs:
      url: { from: { route: file-open } }
    metadata:
      display:
        title: Markdown
    spec:
      mimeTypes: [text/markdown]
      extensions: [.md]
```

ユーザーがファイルを開くと output `url` が参照する route にリダイレクト
されます。 `:id` は URL encode されたファイル ID に置換されます。 `:id` は
path segment として **必須** で、 `:id` を含まない `publication.file-handler@v1`
publication は storage の handler catalog には出ません。 current storage UI
は起動時に `space_id` query parameter も付けます。 file ID を `file_id`
query parameter で渡す fallback はありません。

## 複数ハンドラー

```yaml
routes:
  - id: file-open
    expose: { component: web, contract: ui }
    via: { ref: route.https@v1, config: { path: /files/:id } }
  - id: image-viewer
    expose: { component: web, contract: ui }
    via: { ref: route.https@v1, config: { path: /viewer/:id } }

publications:
  - name: markdown
    ref: publication.file-handler@v1
    outputs:
      url: { from: { route: file-open } }
    metadata:
      display: { title: Markdown }
    spec:
      mimeTypes: [text/markdown]
      extensions: [.md]
  - name: image
    ref: publication.file-handler@v1
    outputs:
      url: { from: { route: image-viewer } }
    metadata:
      display: { title: Images }
    spec:
      mimeTypes: [image/png, image/jpeg, image/gif]
      extensions: [.png, .jpg, .jpeg, .gif]
```

`publications` に複数の `publication.file-handler@v1` entry を並べれば
よい。 同一 manifest 内で publication 名は一意である必要があります。

## フィールド

`publication.file-handler@v1` の output / metadata / spec schema は次を
受け付けます。

| field             | required    | 説明                                                                       |
| ----------------- | ----------- | -------------------------------------------------------------------------- |
| `name`            | yes         | publication 名。 storage UI の handler 表示名にも使われる                  |
| `ref`             | yes         | `publication.file-handler@v1`                                              |
| `outputs.url`     | yes         | `from: { route: <id> }` (`:id` path segment が必須)                        |
| `metadata.display.title` | no   | discovery metadata。 storage API response には含まれるが、 current UI 表示は `name` |
| `spec.mimeTypes`  | conditional | 対応する MIME type のリスト                                                |
| `spec.extensions` | conditional | 対応するファイル拡張子のリスト                                             |

`spec.mimeTypes` と `spec.extensions` は少なくとも一方が必須です。
両方を指定することもできます。 storage の file handler discovery は `:id`
path segment を含む handler だけを返します。 current storage UI はこの
template URL の `:id` を file ID に置換し、 `space_id` query parameter を
追加して開きます。 handler 側は path segment の file ID を primary contract
として扱い、 必要なら `space_id` を補助情報として読めます。

descriptor の normative 定義は
[Official Descriptor Set v1 § publication.file-handler@v1](/takos-paas/descriptors/official-descriptor-set-v1#publicationfile-handlerv1)
を参照。

## Publication の仕組み

kernel は多くの publication descriptor の意味を解釈しません。
`publication.file-handler@v1` を理解するのは利用する側 (agent runtime や
storage UI 等) の役割です。 `publications` は generic plugin resolver
ではなく、 manifest で宣言した route metadata の catalog です。

他の primitive が file handler を使うには、 その publication を
`bindings[].from.publication` で consume するか、 既存の storage endpoint
(`GET /api/spaces/:spaceId/storage/file-handlers`) から参照します。 この
endpoint は manifest publication catalog を参照して handler を選択します。
kernel は未参照の publication を自動で space 全体へ inject しません。
control plane API で `publication.file-handler@v1` route publication を
直接作る運用は推奨しません。

## Discovery API selection ranking

`GET /api/spaces/:spaceId/storage/file-handlers?mime=...&ext=...` で複数の
handler が match した場合、 以下の order で sort されます (rank 0 が
最優先):

| rank | 条件                             |
| ---- | -------------------------------- |
| 0    | mime + ext 両方が exact match    |
| 1    | mime のみ match (ext 不問)       |
| 2    | extension のみ match (mime 不問) |
| 3    | filter 無し (no params)          |

同 rank 内では declaration order (DB 登録順、 `created_at ASC`) で tie-break。

## 次のステップ

- [MCP Server](/apps/mcp) --- MCP Server の公開方法
- [Deploy Manifest](/deploy/manifest) --- `.takos/app.yml` の全体像
