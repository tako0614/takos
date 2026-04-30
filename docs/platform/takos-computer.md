# takos-computer

Browser automation と sandbox computer を提供する default app。default app
distribution metadata を持つが、primitive や group は特権化されない。

## 役割

- sandbox session の作成・管理
- browser / computer automation 用の UI surface
- agent が直接使える published MCP tool surface
- session ごとの MCP proxy endpoint
- Cloudflare Workers + attached container で sandbox runtime を起動
- kernel の Storage / Memory / Thread / Run / Repository / MCP API に built-in
  provider consume 経由でアクセス

## Takos 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

single worker (`web`) と attached container (`sandbox`) の構成。

```text
{hostname}
  /mcp                         → published MCP endpoint for agents
  /gui                         → dashboard / computer UI
  /healthz                     → liveness health check
  /health                      → health alias
  /readyz                      → readiness check
  /create                      → sandbox session creation
  /session/:id                 → sandbox session state
  /session/:id/mcp             → sandbox MCP proxy
  /gui/api/sandbox-session/:id/mcp → dashboard MCP proxy
  /icons/computer.svg          → launcher icon
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
  - id: healthz
    target: web
    path: /healthz
  - id: health
    target: web
    path: /health
  - id: readyz
    target: web
    path: /readyz
  - id: create
    target: web
    path: /create
  - id: icon
    target: web
    path: /icons/computer.svg
  - id: session
    target: web
    path: /session
  - id: session-mcp
    target: web
    path: /session/:id/mcp
  - id: gui-session-mcp
    target: web
    path: /gui/api/sandbox-session/:id/mcp

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

`takos.ui-surface.v1` / `takos.mcp-server.v1` の canonical 定義は
[publication types](/reference/glossary#publication-types) を参照。`/mcp` は `computer_shell_exec`
/ `computer_file_read` / `computer_file_write` などの `computer_*` tools
を公開し、必要に応じて sandbox session を作成して `/session/:id/mcp` に proxy
します。`takos-computer-api` は route publication ではなく、kernel API への
access を受け取る local consume 名です。

published MCP endpoint の auth は `auth.bearer.secretRef:
PUBLISHED_MCP_AUTH_TOKEN` が canonical contract です。Takos managed deploy では
この publication secret が生成され、agent-facing `/mcp` bearer token として使われる。
direct Wrangler deploy など legacy / compatibility 経路では
`PUBLISHED_MCP_AUTH_TOKEN` が未設定のときに `SANDBOX_HOST_AUTH_TOKEN` を
published `/mcp` auth token として fallback 利用できる。これは互換用であり、
managed deploy では `PUBLISHED_MCP_AUTH_TOKEN`、host admin/session route 用の
`SANDBOX_HOST_AUTH_TOKEN`、worker-to-container 用の `MCP_AUTH_TOKEN` を分ける。

published MCP tools は session 引数として snake_case と camelCase の両方を受け付ける。
`session_id` / `sessionId`、`space_id` / `spaceId`、`user_id` / `userId` の
request 値がある場合はそれを使う。省略時は agent-facing default session として
`session_id=agent-default`、`space_id=published-mcp`、`user_id=takos-agent`
を使う。session 作成時の `space_id` / `spaceId` は container env
`TAKOS_SPACE_ID` に反映され、sandbox 内の Takos API / CLI 操作が対象 space を
判断する fallback context になる。既に起動済みで stopped ではない同一 session
がある場合は既存 session state の space が維持され、後続 request の
`space_id` / `spaceId` では上書きしない。

## Runtime

manifest は `.takos/workflows/deploy.yml` の `build-sandbox-host` job から
worker bundle を生成し、`apps/sandbox/Dockerfile` を attached container として
宣言する。tracked reference Workers backend では container class `SandboxSessionContainer` を
`SANDBOX_CONTAINER` binding として worker に渡す。 `compute.web.readiness` は
`/readyz` を参照し、container health check は `/healthz` を参照する。worker
route は `/healthz`、`/health`、`/readyz` と launcher icon の
`/icons/computer.svg` も公開する。

## Resources

| resource             | 用途                                        |
| -------------------- | ------------------------------------------- |
| `session-index`      | sandbox session index 用 key-value resource |
| `sandbox-host-token` | worker / sandbox host 間の generated secret |
| `sandbox-mcp-token`  | sandbox MCP proxy 用 generated secret       |

## Scopes

takos-computer は sandbox automation と agent integration のため、office 系
default apps より広い Takos API scopes を要求する。default set に含まれても
scope は manifest の built-in provider consume request と operator policy に
従って通常通り管理される。
