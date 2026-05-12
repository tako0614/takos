# Store

Store は Takos app layer のカタログ / マーケットプレイス機能です。パッケージの 公開、install、remote repository import
を扱います。takosumi kernel の compute manifest apply とは別 layer です。

## App / InstallableApp / AppInstallation

Store 周辺で使う 3 つの概念を区別します:

| 概念                | 役割                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------- |
| **App**             | Store / UI 上の **product label**。catalog で表示される顔                                          |
| **InstallableApp**  | `.takosumi/app.yml` の `kind: InstallableApp` で宣言される、**Git URL から install される 1 単位** |
| **AppInstallation** | InstallableApp が Takosumi Account の Space に install された **instance** (台帳 record)           |

つまり:

```txt
App (Store の product label)
  └─ InstallableApp (.takosumi/app.yml)
        └─ AppInstallation (Takosumi Account の Space に置かれる instance)
```

Store は InstallableApp の **catalog** として機能し、ユーザーが install ボタンを押すと Takosumi Accounts の
AppInstallation record が作られます。

詳細:

- InstallableApp の manifest (`.takosumi/app.yml`) と install path 全体の正本は [Install Paths](/apps/install-paths)
  を参照
- AppInstallation の record shape / lifecycle は
  [App Installation Ledger](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
  を参照
- Installable App Model の全体設計は
  [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  を参照

## 公開の仕組み

public リポジトリに installer-bound manifest (`.takosumi/app.yml`) と、その `entry.manifest` が指す authoring compute
manifest (`.takosumi/manifest.yml` など) があり、Release を作成すると Store に表示されます。

Store の deployable 判定は release-backed です。public repository の non-draft / non-prerelease release と
`.takosumi/app.yml` を基準にカタログ掲載を判定します。 `.takosumi/manifest.yml` だけでは owner / binding / permission
preview を表せない ため、InstallableApp としては扱いません。release asset は添付ファイルとして扱われ、 Store の
deployable 判定条件ではありません。control plane が Git object store (`GIT_OBJECTS`) を読めず `.takosumi/app.yml` と
`entry.manifest` を確認できない 場合、その release は deployable として扱いません。

## Seed Repositories

Seed Repository は Store カタログとは別の bootstrap 補助です。space 作成時に operator-defined repository
候補を表示するための任意機能であり、Store package / app-label contract の必須要件ではありません。

Takos Agent は Takos product core / `takos-agent` service の機能であり、 InstallableApp ではありません。そのため Store
package や Seed Repository として 扱いません。

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
- package install: Store package の source を AppInstallation pipeline に渡す
- remote repository import: Store Network の remote store から repository reference を取り込む

catalog の `deployable-app` は release-backed の deployable package を 指します。`all` は全 catalog item、`repo` は
repository card、`deployable-app` は release から deploy 可能な package を返します。

`install` という語は package install にだけ使います。remote store からの取り込みは `import repository` と呼びます。

## Store API

以下の `/api/explore/*` や `/api/seed-repositories` は current implementation の public surface です。Store で表示される
`app` は product label であり、deploy model を説明するときは primitive / group を使います。これらの route
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

`space_id` を付けた場合、レスポンスにはその space での AppInstallation summary を付与できます。

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

Install UI はこのレスポンスの `package.repository_url`、`package.release.tag`、`package.version` を使って
AppInstallation preview を作ります。

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

Install UI はこのレスポンスの `version` または `tag` を照合し、選ばれた要素の
`repository_url`、`tag`、`version` を install source として使います。

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
2. installer-bound manifest (`.takosumi/app.yml`) と、そこから参照する authoring compute manifest
   (`.takosumi/manifest.yml`) を追加
3. non-draft / non-prerelease Release を作成

control plane が release commit の `.takosumi/app.yml` と `entry.manifest` を確認できると Store カタログに deployable
package として表示されます。

Seed Repository として新規 space 作成時に表示したい場合は `seed-repositories.ts` に追加します。

## ecosystem で自動化されるもの

InstallableApp manifest と install pipeline を通じて、以下が自動的に関連づけられます:

- group identity / service / route / hostname
- resource binding / OIDC client (`identity.oidc@v1` AppBinding 経由、 詳細は
  [Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md))
- app metadata registration (launcher, MCP server, file handler, etc.)

## MCP 統合

MCP endpoint の workload は Shape manifest の `resources[]` で deploy し、MCP server としての discovery metadata は app
metadata / MCP registry に登録します。

```yaml
mcp:
  endpoints:
    - name: tools
      transport: streamable-http
      url: ${ref:web.url}/mcp
      auth:
        kind: bearer
        tokenRef: mcp-auth-token
```

詳細は [MCP Server](/apps/mcp) と [App Integration Metadata Boundary](/architecture/app-publications) を参照。

## file handler 統合

file handler UI の workload は Shape manifest の `resources[]` で deploy し、 Storage UI 向けの discovery metadata は
file handler registry に登録します。

```yaml
fileHandlers:
  - name: markdown
    title: Markdown
    url: ${ref:web.url}/files/:id
    mimeTypes: [text/markdown]
    extensions: [.md]
```

handler URL は `:id` path segment を必ず含みます。Storage UI は起動時に `space_id` query parameter
も追加しますが、`file_id` query は使いません。 詳細は [File Handlers](/apps/file-handlers) を参照。

## 次に読むページ

- [Deploy Manifest の書き方](/deploy/manifest)
- [マニフェストリファレンス](https://github.com/tako0614/takosumi/blob/master/docs/reference/manifest-spec.md)
- [Repository / Catalog デプロイ](/deploy/store-deploy)
