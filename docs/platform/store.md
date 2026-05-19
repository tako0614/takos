# Store

> このページでわかること: アプリを探してインストールするための Store の仕組み。

Store は Takos のアプリカタログです。アプリの公開、インストール、
リモートリポジトリからのインポートを扱います。

## Catalog App / AppSpec / Installation

Store 周辺で使う 3 つの概念を区別します:

| 概念             | 役割                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------- |
| **Catalog App**  | Store / UI 上の **product label**。catalog で表示される顔                             |
| **AppSpec**      | `.takosumi.yml` で宣言される、**Git URL から install される 1 単位** (= `apiVersion: takosumi.dev/v1` envelope)    |
| **Installation** | AppSpec が Takosumi Account の Space に install された **instance** (台帳 record)     |

つまり:

```txt
Catalog App (Store の product label)
  └─ AppSpec (.takosumi.yml)
        └─ Installation (Takosumi Account の Space に置かれる instance)
```

Store は AppSpec metadata の **catalog** として機能し、ユーザーが install
ボタンを押すと Takosumi Accounts の Installation record が作られます。

詳細:

- AppSpec (`.takosumi.yml`) と install path の詳細は
  [Install Paths](/apps/install-paths) を参照
- Installation の record shape / lifecycle は
  [App Installation Ledger](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
  を参照
- Installable App Model の全体設計は
  [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  を参照

## 公開の仕組み

public リポジトリに `.takosumi.yml` AppSpec があり、Release を作成すると
Store に表示されます。

Store がアプリを deployable として表示する条件は次の 2 つです:

- public リポジトリに **non-draft / non-prerelease** の Release が存在する
- その Release のコミットに `.takosumi.yml` が含まれ、`metadata.id` /
  `metadata.name` / `components` を解釈できる

Release の attachment はカタログ判定には使いません。Store catalog service が
Git object store を読めない場合も deployable 扱いになりません。

## Seed Repositories

Seed Repository は Store カタログとは別の bootstrap 補助です。space 作成時に
operator-defined repository 候補を表示するための任意機能であり、Store package /
app-label contract の必須要件ではありません。

Takos Agent は Takos product core / `takos-agent` service の機能であり、
App ではありません。そのため Store package や Seed Repository として
扱いません。

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

- **package catalog**: public な package release を検索する
- **package install**: Store package のソースを Installation pipeline に渡す
- **remote repository import**: Store Network の remote store から repository を取り込む

catalog の type フィルタは 3 種類:

- `all` — すべての catalog item
- `repo` — repository card
- `deployable-app` — Release から deploy 可能な package

「install」は package install にのみ使います。remote store からの取り込みは
「import repository」と呼びます。

## Store API

`/api/explore/*` と `/api/seed-repositories` は現在の Store の public surface
です。route 形状は将来変更される可能性があります。

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

`space_id` を付けた場合、レスポンスにはその space での Installation summary
を付与できます。

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

Install UI はこのレスポンスの
`package.repository_url`、`package.release.tag`、`package.version` を使って
Installation dry-run を作ります。

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

## AppSpec app を Store に公開するには

1. リポジトリを public にする
2. source root に `.takosumi.yml` AppSpec を追加
3. non-draft / non-prerelease Release を作成

Store catalog service が release commit の `.takosumi.yml` を確認できると
Store カタログに deployable package として表示されます。

Seed Repository として新規 space 作成時に表示したい場合は `seed-repositories.ts`
に追加します。

## ecosystem で自動化されるもの

AppSpec と install pipeline
を通じて、以下が自動的に関連づけられます:

- app identity / service / route / hostname
- resource binding / OIDC client (= namespace pub/sub、 詳細は
  [AppSpec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
  の `publish` / `listen` 章)
- app metadata registration (launcher, MCP server, file handler, etc.)

## MCP 統合

MCP endpoint の workload は AppSpec の worker component で宣言し
(= `spec.routes` で MCP server の HTTP path を expose)、 MCP server としての
discovery metadata は app metadata / MCP registry に登録します。 Wave J で
AppSpec から `interfaces:` top-level field を削除済 (= launcher / MCP /
health endpoint は worker materializer 慣習 + Takos registry 側 metadata の
組み合わせで表現)。

```yaml
apiVersion: takosumi.dev/v1
metadata:
  id: com.example.tools
  name: Example Tools
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    spec:
      routes:
        - tools.example.com/*
        - tools.example.com/mcp
```

詳細は [MCP Server](/apps/mcp) と
[App Integration Metadata Boundary](/architecture/app-publications) を参照。

## file handler 統合

file handler UI の workload は AppSpec の worker component で宣言し
(= `spec.routes` で file handler の HTTP path を expose)、 Storage UI 向けの
discovery metadata は file handler registry に登録します (= Takos product
側 metadata layer)。

```yaml
apiVersion: takosumi.dev/v1
metadata:
  id: com.example.markdown
  name: Markdown Handler
components:
  web:
    kind: worker
    build:
      command: npm ci && npm run build
      output: dist/worker.mjs
    spec:
      routes:
        - docs.example.com/*
        - docs.example.com/files/:id
```

handler URL は `:id` path segment を必ず含みます。Storage UI は起動時に
`space_id` query parameter も追加しますが、`file_id` query は使いません。 詳細は
[File Handlers](/apps/file-handlers) を参照。

## 次に読むページ

- [AppSpec の書き方](/deploy/manifest)
- [AppSpec リファレンス](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [Repository / Catalog デプロイ](/deploy/store-deploy)
