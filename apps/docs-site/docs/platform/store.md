# Store

アプリの公開とインストールの仕組み。

## 公開の仕組み

public リポジトリに `.takos/app.yml` があり、Release を作成すると Store に表示されます。

Release に含まれる `takopack` 形式のアセットが Store カタログに掲載される対象です。アセットには `app_id`、`version`、`description`、`icon` などのメタデータが埋め込まれます。

## Official Packages と Seed Repositories

Takos には Store カタログとは別に、2 つのコード定義リストがあります。

| | Official Packages | Seed Repositories |
|---|---|---|
| 定義場所 | `official-packages.ts`（コード） | `seed-repositories.ts`（コード） |
| 表示タイミング | Store カタログに常時表示 | ワークスペース作成時のポップアップのみ |
| 目的 | ファーストパーティアプリの推奨 | 初回セットアップの推奨リポジトリ |
| DB 依存 | なし（コードで定義） | なし（コードで定義） |
| バッジ | `certified: true` で公式バッジ付き | なし |
| プリチェック | `recommended: true` で上位表示 | `checked: true` でプリチェック |

### Official Packages の型定義

```typescript
interface OfficialPackage {
  id: string;           // "official/takos-computer"
  name: string;         // "Takos Computer"
  description: string;  // 短い説明
  category: 'app' | 'service' | 'library' | 'template' | 'tool';
  url: string;          // Git clone URL
  owner: {
    name: string;
    username: string;
  };
  tags: string[];       // 検索・フィルタ用タグ
  recommended: boolean; // true で上位表示
  priority: number;     // 数値が大きいほど先に表示
}
```

現在登録されている Official Package:

| ID | 名前 | カテゴリ | 説明 |
|---|---|---|---|
| `official/takos-computer` | Takos Computer | tool | Browser automation and agent executor |

### Seed Repositories の型定義

```typescript
interface SeedRepository {
  url: string;        // Git clone URL (HTTPS)
  name: string;       // 表示名
  description: string;// 短い説明
  category: string;   // UI でのグルーピング用
  checked: boolean;   // true でポップアップ上でプリチェック
}
```

現在登録されている Seed Repository:

| 名前 | カテゴリ | プリチェック |
|---|---|---|
| Takos Computer | tool | yes |

## Store API

### カタログ取得

```bash
GET /api/explore/catalog?sort=trending&limit=20
```

クエリパラメータ:

| パラメータ | 説明 | 例 |
|---|---|---|
| `q` | フリーテキスト検索 | `browser` |
| `sort` | ソート順 (`trending`, `new`, `stars`, `updated`, `downloads`) | `trending` |
| `type` | タイプフィルタ (`all`, `repo`, `deployable-app`, `official`) | `all` |
| `category` | カテゴリフィルタ | `tool` |
| `tags` | カンマ区切りのタグフィルタ | `browser,automation` |
| `certified_only` | 公式パッケージのみ | `true` |
| `limit` | 取得件数（最大 50、デフォルト 20） | `20` |
| `offset` | ページネーション用オフセット | `0` |

```bash
# 公式パッケージだけ取得
curl "https://takos.example.com/api/explore/catalog?type=official&sort=stars"

# タグで絞り込み
curl "https://takos.example.com/api/explore/catalog?tags=browser,automation&limit=10"
```

### パッケージ検索

```bash
GET /api/explore/packages?q=browser&sort=popular&limit=20
```

### パッケージサジェスト

```bash
GET /api/explore/packages/suggest?q=tak&limit=10
```

### 特定パッケージの最新バージョン

```bash
GET /api/explore/packages/{username}/{repoName}/latest
```

レスポンス例:

```json
{
  "package": {
    "name": "takos-computer",
    "app_id": "takos-computer",
    "version": "1.0.0",
    "description": "Browser automation and agent executor",
    "repository": {
      "id": "repo_xxx",
      "name": "takos-computer",
      "stars": 42
    },
    "owner": {
      "username": "takos"
    },
    "release": {
      "tag": "v1.0.0",
      "published_at": "2026-03-01T00:00:00.000Z"
    },
    "rating_avg": 4.5,
    "rating_count": 10
  }
}
```

### パッケージのバージョン一覧

```bash
GET /api/explore/packages/{username}/{repoName}/versions
```

### Seed Repositories 取得

```bash
GET /api/seed-repositories
```

レスポンス例:

```json
{
  "repositories": [
    {
      "url": "https://github.com/tako0614/takos-computer.git",
      "name": "Takos Computer",
      "description": "Browser automation and agent executor",
      "category": "tool",
      "checked": true
    }
  ]
}
```

認証不要 --- 静的な公開設定として返されます。

## アプリを Store に公開するには

1. リポジトリを public にする
2. `.takos/app.yml` を追加
3. Release を作成（`takopack` 形式のアセットを含める）

これだけで自動的に Store カタログに表示されます。

Official Package として登録したい場合は `official-packages.ts` にエントリを追加してください。Seed Repository として新規ワークスペース作成時に表示したい場合は `seed-repositories.ts` に追加します。

## ecosystem で自動化されるもの

manifest と deploy を通じて、以下が自動的に関連づけられます:

- app identity / service / route / hostname
- resource binding / OAuth client
- MCP server registration / file handler matcher

## MCP 統合

```yaml
spec:
  mcpServers:
    - name: notes
      route: /mcp
      transport: streamable-http
```

deploy 後に control plane が MCP endpoint を登録し、agent 側が server をロードする。詳細は [MCP Server](/apps/mcp) を参照。

## file handler 統合

```yaml
spec:
  fileHandlers:
    - name: markdown
      mimeTypes: [text/markdown]
      extensions: [.md]
      openPath: /files/:id
```

space storage と app UI が loose coupling のまま連携できる。詳細は [File Handlers](/apps/file-handlers) を参照。

## 次に読むページ

- [app.yml の書き方](/apps/manifest)
- [マニフェストリファレンス](/reference/manifest-spec)
- [Store 経由デプロイ](/deploy/store-deploy)
