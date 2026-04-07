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
  /     → プレゼンテーション UI (UiSurface)
  /mcp  → MCP Server (McpServer)
```

## Publications

```yaml
publish:
  - type: UiSurface
    path: /
    title: Slide
  - type: McpServer
    path: /mcp
```

## Scopes

| scope | 用途 |
| --- | --- |
| files:read | kernel の Storage からファイル読み取り |
| files:write | kernel の Storage へファイル書き込み |
