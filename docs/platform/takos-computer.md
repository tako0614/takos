# takos-computer

Browser automation と sandbox computer を提供する default app。default app
distribution metadata を持つが、primitive や group は特権化されない。

## 役割

- sandbox session の作成・管理
- browser / computer automation 用の UI surface
- session ごとの MCP proxy endpoint
- Cloudflare Workers + attached container で sandbox runtime を起動
- kernel の Storage / Memory / Thread / Run / Repository / MCP API に system consume 経由でアクセス

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

single worker (`web`) と attached container (`sandbox`) の構成。

```text
{hostname}
  /gui                         → dashboard / computer UI
  /create                      → sandbox session creation
  /session/:id                 → sandbox session state
  /session/:id/mcp             → sandbox MCP proxy
  /gui/api/sandbox-session/:id/mcp → dashboard MCP proxy
```

## Publications

```yaml
publish:
  - name: computer-ui
    publisher: web
    type: UiSurface
    outputs:
      url:
        route: /gui
    title: Computer
compute:
  web:
    consume:
      - publication: takos.api-key
        as: takos-computer-api
        request:
          scopes:
            - spaces:read
            - files:read
            - files:write
            - memories:read
            - memories:write
            - threads:read
            - threads:write
            - runs:read
            - runs:write
            - agents:execute
            - repos:read
            - repos:write
            - mcp:invoke
            - events:subscribe
```

`UiSurface` は custom route publication type であり、deploy manifest の
`publish` entry で catalog を管理します。`takos-computer-api` は route
publication ではなく、kernel API への access を受け取る local consume 名です。

## Runtime

manifest は `.takos/workflows/deploy.yml` の `build-sandbox-host` job から
worker bundle を生成し、`apps/sandbox/Dockerfile` を attached container として
宣言する。Cloudflare backend では container class
`SandboxSessionContainer` を `SANDBOX_CONTAINER` binding として worker に渡す。

## Resources

| resource           | 用途                                          |
| ------------------ | --------------------------------------------- |
| `session-index`    | sandbox session index 用 key-value resource   |
| `sandbox-host-token` | worker / sandbox host 間の generated secret |
| `sandbox-mcp-token`  | sandbox MCP proxy 用 generated secret       |

## Scopes

takos-computer は sandbox automation と agent integration のため、office 系
default apps より広い Takos API scopes を要求する。default set に含まれても
scope は manifest の system consume request と operator policy に従って通常通り
管理される。
