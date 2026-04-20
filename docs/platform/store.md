# Store

Store は Takos kernel に統合されたカタログ / マーケットプレイス機能です。
パッケージの公開、install、remote repository import を扱います。

## 公開の仕組み

public リポジトリに deploy manifest (`.takos/app.yml` / `.takos/app.yaml`)
があり、Release を作成すると Store に表示されます。

Store の deployable 判定は release-backed です。public repository の non-draft /
non-prerelease release と `.takos/app.yml` / `.takos/app.yaml`
を基準にカタログ掲載を判定します。release asset
は添付ファイルとして扱われ、Store の deployable 判定条件では ありません。
control plane が Git object store (`GIT_OBJECTS`) を読めず `.takos/app.yml` /
`.takos/app.yaml` を確認できない場合、その release は deployable
として扱いません。

## Seed Repositories

Seed Repository は Store カタログとは別の bootstrap 補助です。space 作成時に
operator-defined repository 候補を表示するための任意機能であり、Store package /
app-label contract の必須要件ではありません。

Takos Agent は kernel / agent runtime に含まれるため、Store package や Seed
Repository として扱いません。

### Seed Repositories の型定義

```typescript
interface SeedRepository {
  url: string; // Git clone URL (HTTPS)
  name: string; // 表示名
  description: string; // 短い説明
  category: string; // UI でのグルーピング用
  checked: boolean; // true でポップアップ上でプリチェック
}
```

現在登録されている Seed Repository:

なし。

## Store の 3 つの経路

- package catalog: public な package release を検索する
- package install: Store package の source を解決して deploy pipeline に渡す
- remote repository import: ActivityPub remote store
  からリポジトリ参照を取り込む

catalog の `deployable-app` は release-backed の deployable package を
指します。`all` は全 catalog item、`repo` は repository card、`deployable-app`
は release から deploy 可能な package を返します。

`install` という語は package install にだけ使います。remote store
からの取り込みは `import repository` と呼びます。

## Store API

以下の `/api/explore/*` や `/api/seed-repositories` は current implementation の
public surface です。Store で表示される `app` は product label であり、deploy
model を説明するときは primitive / group を使います。これらの route
形状そのものを不変 contract とみなすわけではありません。

### カタログ取得

```bash
GET /api/explore/catalog?sort=trending&limit=20
```

クエリパラメータ:

| パラメータ       | 説明                                                                                                    | 例           |
| ---------------- | ------------------------------------------------------------------------------------------------------- | ------------ |
| `q`              | フリーテキスト検索                                                                                      | `notes`      |
| `sort`           | ソート順 (`trending`, `new`, `stars`, `updated`, `downloads`)                                           | `trending`   |
| `type`           | タイプフィルタ (`all`, `repo`, `deployable-app`)。`deployable-app` は release-backed deployable package | `all`        |
| `category`       | カテゴリフィルタ                                                                                        | `app`        |
| `tags`           | カンマ区切りのタグフィルタ                                                                              | `docs,notes` |
| `certified_only` | approved package のみ                                                                                   | `true`       |
| `space_id`       | 認証 user がアクセスできる space での installation 情報を付ける                                         | `space_123`  |
| `limit`          | 取得件数（最大 50、デフォルト 20）                                                                      | `20`         |
| `offset`         | ページネーション用オフセット                                                                            | `0`          |

```bash
# タグで絞り込み
curl "https://takos.example.com/api/explore/catalog?tags=docs,notes&limit=10"
```

`space_id` を付けた場合、レスポンスの
`installation.group_deployment_snapshot_id` は current group snapshot の ID
です。legacy `bundle_deployments` ID はここに入りません。

### パッケージ検索

```bash
GET /api/explore/packages?q=notes&sort=popular&limit=20
```

### パッケージサジェスト

```bash
GET /api/explore/packages/suggest?q=tak&limit=10
```

### 特定パッケージの最新バージョン

```bash
GET /api/explore/packages/{username}/{repoName}/latest
```

`takos install` はこのレスポンスの
`package.repository_url`、`package.release.tag`、`package.version` を使って
deploy source を解決します。

レスポンス例:

```json
{
  "package": {
    "version": "1.0.0",
    "repository_url": "https://github.com/acme/acme-notes.git",
    "release": {
      "tag": "v1.0.0",
      "published_at": "2026-03-01T00:00:00.000Z"
    }
  }
}
```

### パッケージのバージョン一覧

```bash
GET /api/explore/packages/{username}/{repoName}/versions
```

`takos install --version <value>` はこのレスポンスの `version` または `tag`
を照合し、選ばれた要素の `repository_url`、`tag`、`version` を deploy source
として使います。

レスポンス例:

```json
{
  "versions": [
    {
      "version": "1.0.0",
      "repository_url": "https://github.com/acme/acme-notes.git",
      "tag": "v1.0.0"
    },
    {
      "version": "1.1.0",
      "repository_url": "https://github.com/acme/acme-notes.git",
      "tag": "v1.1.0"
    }
  ]
}
```

### Seed Repositories 取得

```bash
GET /api/seed-repositories
```

レスポンス例:

```json
{
  "repositories": []
}
```

認証不要 --- 静的な公開設定として返されます。

## group を Store に公開するには

1. リポジトリを public にする
2. deploy manifest (`.takos/app.yml` / `.takos/app.yaml`) を追加
3. non-draft / non-prerelease Release を作成

control plane が release commit の `.takos/app.yml` / `.takos/app.yaml`
を確認できると Store カタログに deployable package として表示されます。

Seed Repository として新規 space 作成時に表示したい場合は `seed-repositories.ts`
に追加します。

## ecosystem で自動化されるもの

manifest と deploy を通じて、以下が自動的に関連づけられます:

- group identity / service / route / hostname
- resource binding / OAuth client
- publication registration (MCP server, file handler, etc.)

## MCP 統合

manifest の `publish` で `type: McpServer` を宣言する。

```yaml
publish:
  - name: tools
    type: McpServer
    publisher: web
    path: /mcp
    spec:
      transport: streamable-http
```

MCP server catalog は deploy manifest の `publish` entry で管理します。deploy
後に control plane が catalog entry を保存し、agent 側が server をロードする。
`McpServer` は custom route publication type であり、core の固定 type
ではありません。詳細は [MCP Server](/apps/mcp) を参照。publication
の仕組みについては [Publication / Grants](/architecture/app-publications)
を参照。

## file handler 統合

manifest の `publish` で `type: FileHandler` を宣言する。

```yaml
publish:
  - name: markdown
    type: FileHandler
    publisher: web
    path: /files/:id
    spec:
      mimeTypes: [text/markdown]
      extensions: [.md]
```

FileHandler catalog は deploy manifest の `publish` entry で管理します。space
storage と deployed UI が loose coupling のまま連携できる。`FileHandler` の
`path` は `:id` path segment を必ず含み、storage catalog では `:id` を含まない
handler を公開しません。`FileHandler` の launch contract は file ID の path
segment が primary です。current storage UI は起動時に `space_id` query
parameter も追加しますが、`file_id` query fallback はありません。 `FileHandler`
は custom route publication type です。詳細は
[File Handlers](/apps/file-handlers) を参照。publication の仕組みについては
[Publication / Grants](/architecture/app-publications) を参照。

## 次に読むページ

- [Deploy Manifest の書き方](/apps/manifest)
- [マニフェストリファレンス](/reference/manifest-spec)
- [Repository / Catalog デプロイ](/deploy/store-deploy)
