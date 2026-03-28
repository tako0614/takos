# Store / Package

アプリを Store に公開して、他のユーザーが発見・インストールできるようにする仕組み。

## package とは

`.takos/app.yml` を持つ Git リポジトリが package。deploy の正本は `app.yml`、source provenance の正本は repo ID + ref。

## 配信チャネル

| チャネル | 説明 |
| --- | --- |
| **Store Catalog** | public リポジトリが Release を作ると自動掲載。Store UI からインストール |
| **Official Packages** | コード定義の公式パッケージ。`certified: true` バッジ付きで常時表示 |
| **Seed Repositories** | 新規ワークスペース作成時のポップアップに表示される推奨リポジトリ |

## Store に公開する方法

1. `.takos/app.yml` を持つ public リポジトリを用意
2. Release を作成 → Store Catalog に自動掲載

Official packages として登録したい場合は `official-packages.ts` にエントリを追加する。

## ecosystem で自動化されるもの

manifest と deploy を通じて、以下が自動的に関連づけられる:

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
