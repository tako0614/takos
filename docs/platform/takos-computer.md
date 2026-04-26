# takos-computer

Browser automation と sandbox computer を提供する default app。default app
distribution metadata を持つが、primitive や group は特権化されない。

## 役割

- sandbox session の作成・管理
- browser / computer automation 用の UI surface
- agent が直接使える published MCP tool surface
- session ごとの MCP proxy endpoint
- Cloudflare Workers + attached container で sandbox runtime を起動
- kernel の Storage / Memory / Thread / Run / Repository / MCP API に built-in provider consume 経由でアクセス

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

single worker (`web`) と attached container (`sandbox`) の構成。

```text
{hostname}
  /mcp                         → published MCP endpoint for agents
  /gui                         → dashboard / computer UI
  /create                      → sandbox session creation
  /session/:id                 → sandbox session state
  /session/:id/mcp             → sandbox MCP proxy
  /gui/api/sandbox-session/:id/mcp → dashboard MCP proxy
```

## Publications

```yaml
routes:
  - id: gui
    target: web
    path: /gui
  - id: mcp
    target: web
    path: /mcp

publish:
  - name: computer-ui
    type: takos.ui-surface.v1
    display:
      title: Computer
    outputs:
      url:
        kind: url
        routeRef: gui
  - name: computer-mcp
    type: takos.mcp-server.v1
    auth:
      bearer:
        secretRef: PUBLISHED_MCP_AUTH_TOKEN
    outputs:
      url:
        kind: url
        routeRef: mcp
    spec:
      transport: streamable-http
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

`takos.ui-surface.v1` は UI surface publication type であり、deploy manifest の
`publish` entry で catalog を管理します。`takos.mcp-server.v1` は agent tool
catalog に読み込まれる published MCP entry です。`/mcp` は
`computer_shell_exec` / `computer_file_read` / `computer_file_write` などの
`computer_*` tools を公開し、必要に応じて sandbox session を作成して
`/session/:id/mcp` に proxy します。`takos-computer-api` は route publication
ではなく、kernel API への access を受け取る local consume 名です。

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
scope は manifest の built-in provider consume request と operator policy に
従って通常通り管理される。
