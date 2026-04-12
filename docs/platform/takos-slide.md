# takos-slide

プレゼンテーションエディタ app (Google Slides alternative)。

## 役割

- プレゼンテーションの作成・編集
- スライド操作 (追加 / 削除 / 並び替え)
- テキスト・図形・画像の配置
- MCP Server でスライド操作 tools を提供
- UiSurface でプレゼンテーション UI を提供
- standalone でも動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-slide.app.example.com` or `slides.mycompany.com`

single worker (web) 構成。

```text
{hostname}
  /     → built frontend / static asset surface (deployment mount)
  /mcp  → MCP Server (McpServer)
```

## Publications

`path: /` は built frontend / static asset surface の mount point を表し、server entrypoint 自体の root route を意味しない。

```yaml
publish:
  - name: slide-ui
    type: UiSurface
    path: /
    title: Slide
  - name: slide-mcp
    type: McpServer
    path: /mcp
```

UI は build 済みの frontend / static asset surface として mount され、server entrypoint は MCP と health を公開する。

## Scopes

| scope | 用途 |
| --- | --- |
| files:read | kernel の Storage からファイル読み取り |
| files:write | kernel の Storage へファイル書き込み |
