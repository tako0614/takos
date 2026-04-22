# takos-slide

Google Slides alternative のプレゼンテーションエディタ。default app distribution
metadata を持つが、primitive や group は特権化されない。

## 役割

- プレゼンテーションの作成・編集
- スライド操作 (追加 / 削除 / 並び替え)
- テキスト・図形・画像の配置
- source tree の standalone MCP server でスライド操作 tools を提供
- UiSurface でプレゼンテーション UI を提供
- group に所属しなくても動作可能

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

例: `team-a-my-slide.app.example.com` or `slides.mycompany.com`

single worker (web) 構成。

```text
{hostname}
  /     → built frontend / static asset surface (deployment mount)
  /mcp  → Slide MCP server (streamable HTTP)
```

## Publications

`outputs.url.route: /` は built frontend / static asset surface の mount point を
表し、server entrypoint 自体の root route を意味しない。

```yaml
publish:
  - name: slide-ui
    type: UiSurface
    publisher: web
    outputs:
      url:
        route: /
    title: Slide
  - name: slide-mcp
    type: McpServer
    publisher: web
    outputs:
      url:
        route: /mcp
    title: Slide MCP
    spec:
      transport: streamable-http
      authSecretRef: MCP_AUTH_TOKEN
```

`UiSurface` は custom route publication type であり、deploy manifest の
`publish` entry で catalog を管理します。`McpServer` は agent runtime が
参照する MCP catalog entry です。

## Takos built-in provider publication

`takos-api` は route / interface publication ではなく、kernel API への access を
受け取る local consume 名です。実体は `takos.api-key` built-in provider
publication の consume です。

```yaml
compute:
  web:
    consume:
      - publication: takos.api-key
        as: takos-api
        request:
          scopes:
            - files:read
            - files:write
```

default app manifest / workflow は UI と `/mcp` を同じ worker に含める。MCP
publication は `authSecretRef: MCP_AUTH_TOKEN` を宣言し、control plane が
worker-scoped secret env を用意する。実装は `MCP_AUTH_TOKEN` が未設定、かつ
`MCP_ALLOW_UNAUTHENTICATED=true` が明示されていない場合に fail closed する。
manifest の `routes` は `/` と `/mcp` の両方を `web` target に向ける。

## Scopes

| scope       | 用途                                   |
| ----------- | -------------------------------------- |
| files:read  | kernel の Storage からファイル読み取り |
| files:write | kernel の Storage へファイル書き込み   |
