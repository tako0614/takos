# Store

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

> このページでわかること: アプリを探してインストールするための Store の仕組み。

Store は Takos
のアプリカタログです。アプリの公開、インストール、リモートリポジトリからのインポートを扱います。

## Catalog App / AppSpec / Installation

Store 周辺で使う 3 つの概念を区別します:

| 概念             | 役割                                                                                    |
| ---------------- | --------------------------------------------------------------------------------------- |
| **Catalog App**  | Store / UI 上の **product label**。catalog で表示される顔                               |
| **AppSpec**      | `.takosumi.yml` で宣言される、Installer API に渡す 1 単位 (= `apiVersion: v1` envelope) |
| **Installation** | AppSpec が Takosumi Account の Space に install された **instance** (台帳 record)       |

つまり:

```txt
Catalog App (Store の product label)
  └─ AppSpec (.takosumi.yml)
        └─ Installation (Takosumi Account の Space に置かれる instance)
```

Store は AppSpec metadata の **catalog** として機能し、ユーザーが install
ボタンを押すと Takosumi Accounts の Installation record が作られます。Store
catalog discovery は Git release / AppSpec metadata を読みます。実際に Installer
API へ渡す install source は、Git source または operator build service が作った
prepared source です。

詳細:

- AppSpec (`.takosumi.yml`) と install path の詳細は
  [Install Paths](/apps/install-paths) を参照
- Installation の record shape / lifecycle は
  [Takosumi Cloud entry point](https://takosumi.com/docs/reference/takosumi-cloud)
  を参照
- Takosumi Installation Lifecycle の全体設計は
  [Takosumi Installation Lifecycle](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  を参照

## 公開の仕組み

public リポジトリに `.takosumi.yml` AppSpec があり、Release を作成すると Store
に表示されます。

Store がアプリを deployable として表示する条件は次の 2 つです:

- public リポジトリに **non-draft / non-prerelease** の Release が存在する
- その Release のコミットに `.takosumi.yml` が含まれ、`metadata.id` /
  `metadata.name` / `components` を解釈できる

Release の attachment はカタログ判定には使いません。runtime file を build で生
成する app は、install 時に operator build service / CI が prepared source を作
り、Installer API に source URL と digest を渡します。Store catalog service が
Git object store を読めない場合も deployable 扱いになりません。

## Seed Repositories

Seed Repository は Store カタログとは別の bootstrap 補助です。space 作成時に
operator-defined repository 候補を表示するための任意機能であり、Store package /
app-label contract の必須要件ではありません。

Takos Agent は Takos product core / `takos-agent` service の機能であり、 App
ではありません。そのため Store package や Seed Repository として扱いません。

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
- **remote repository import**: Store Network の remote store から repository
  を取り込む

catalog の type フィルタは 3 種類:

- `all` —すべての catalog item
- `repo` — repository card
- `deployable-app` — Release から deploy 可能な package

「install」は package install にのみ使います。remote store
からの取り込みは「import repository」と呼びます。

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

Store catalog service が release commit の `.takosumi.yml` を確認できると Store
カタログに deployable package として表示されます。

Seed Repository として新規 space 作成時に表示したい場合は `seed-repositories.ts`
に追加します。

## ecosystem で自動化されるもの

Takosumi install pipeline と Takos product registry を通じて、以下が関連づけら
れます:

- app identity / service / route / hostname
- resource binding / OIDC client (= AppSpec connect/listen、詳細は
  [AppSpec](https://takosumi.com/docs/reference/manifest) の `connect` /
  `listen` 章)
- Takos app metadata registration (launcher, MCP server, file handler, etc.)

## MCP 統合

MCP endpoint の workload は AppSpec の worker component で HTTP material を
publish し、adopted gateway/ingress component で public endpoint intent を宣言します。MCP server
としての discovery metadata は app metadata / MCP registry に登録します。
launcher / MCP / health metadata は Takos product 内部 metadata layer (= app
launcher / MCP registry、AppSpec contract とは別 layer)
の組み合わせで表現します。

```yaml
apiVersion: v1
metadata:
  id: com.example.tools
  name: Example Tools
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
  public:
    kind: gateway
    connect:
      upstream:
        output: web.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
          host: tools.example.com
          tls: auto
      routes:
        - listener: public
          path: /
          to: upstream
```

`/mcp` は Takos MCP registry metadata と worker 実装が扱う runtime path
です。詳細は [MCP Server](/apps/mcp) と
[App Integration Metadata Boundary](/architecture/app-publications) を参照。

## file handler 統合

file handler UI の workload は AppSpec の worker component で HTTP material を
publish し、adopted gateway/ingress component で public endpoint を公開します。`/files/:id` の
path template と Storage UI 向け discovery metadata は file handler registry
に登録 します (= Takos product 側 metadata layer)。

```yaml
apiVersion: v1
metadata:
  id: com.example.markdown
  name: Markdown Handler
components:
  web:
    kind: worker
    spec:
      entrypoint: src/worker/index.ts
  public:
    kind: gateway
    connect:
      upstream:
        output: web.http
        inject: upstream
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

handler URL は runtime path の `:id` segment を必ず含みます。Storage UI
は起動時に `space_id` query parameter も追加しますが、`file_id` query
は使いません。詳細は [File Handlers](/apps/file-handlers) を参照。

## 次に読むページ

- [Takos AppSpec examples](/deploy/manifest)
- [AppSpec リファレンス](https://takosumi.com/docs/reference/manifest)
- [Repository / Catalog デプロイ](/deploy/store-deploy)
