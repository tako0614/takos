# takos-computer

Browser automation と sandbox computer を提供する bundled app。bundled app
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
  /gui/api/auth/callback       → OIDC callback (Takosumi Accounts 経由)。詳細: [OIDC Consumer](/apps/oidc-consumer)
  /healthz                     → liveness health check
  /health                      → health alias
  /readyz                      → readiness check
  /create                      → sandbox session creation
  /session/:id                 → sandbox session state
  /session/:id/mcp             → sandbox MCP proxy
  /gui/api/sandbox-session/:id/mcp → dashboard MCP proxy
  /icons/computer.svg          → launcher icon
```

## App Metadata And Grants

```yaml
launcher:
  name: computer-ui
  title: Computer
  url: ${ref:web.url}/gui
mcp:
  endpoints:
    - name: computer-mcp
      transport: streamable-http
      url: ${ref:web.url}/mcp
      auth:
        kind: bearer
        tokenRef: published-mcp-auth-token
grants:
  requested:
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

launcher / MCP endpoint は kernel manifest の `publications[]` ではなく Takos
app catalog / MCP registry の metadata です。`/mcp` は `computer_shell_exec` /
`computer_file_read` / `computer_file_write` などの `computer_*` tools
を公開し、 必要に応じて sandbox session を作成して `/session/:id/mcp` に proxy
します。 Takos API access は app-layer grant から materialize されます。

published MCP endpoint の auth は `PUBLISHED_MCP_AUTH_TOKEN` が canonical
runtime credential です。これは **MCP integration の internal credential** で
あり、agent (= MCP client) が `/mcp` を呼ぶときの machine-to-machine bearer
token として機能します。end-user (人間ユーザー) の 認証は `identity.oidc@v1`
AppBinding (Takosumi Accounts) 経由の OIDC consumer flow で別 layer
として処理し、`PUBLISHED_MCP_AUTH_TOKEN` は OIDC consumer flow
には関与しません。

Takos managed deploy ではこの registry secret が生成され、agent-facing `/mcp`
bearer token として使われる。`PUBLISHED_MCP_AUTH_TOKEN`、host admin/session
route 用の `SANDBOX_HOST_AUTH_TOKEN`、worker-to-container 用の `MCP_AUTH_TOKEN`
は分けて扱う。これら 3 token はすべて MCP / sandbox host 内部の machine
credential であり、Takos itself の **end-user 認証は OIDC consumer 経由**
(`identity.oidc@v1` AppBinding) として明確に分離される。

## Bindings

takos-computer は他の bundled apps と同様に **OIDC consumer** であり、 end-user
sign-in を `operator.identity.oidc` namespace export で解決される Takosumi
Accounts に委譲する。 `.takosumi/app.yml` で `identity.oidc@v1` AppBinding を
declare し、installer (takosumi-git) が installation 単位の OIDC client を
Takosumi Accounts に 登録、`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` /
`OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI` を runtime に inject する (詳細:
[OIDC Consumer](/apps/oidc-consumer) /
[binding-catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md#_1-identity-oidc-v1))。

```yaml
bindings:
  auth:
    type: identity.oidc@v1
    required: true
    redirectPaths:
      - /gui/api/auth/callback
    allowedScopes:
      - openid
      - email
      - profile
    subjectMode: pairwise
```

OIDC callback path は `/gui/api/auth/callback` を使い、 dashboard / computer UI
の app session を発行する。 takos-computer 自身は OAuth provider を持たず、 OIDC
issuer は常に `identity.oidc@v1` AppBinding 経由で Takosumi Accounts から提供
される。self-host operator が Keycloak / Authentik 等を使う場合も、それらは
Takosumi Accounts の upstream IdP として接続する。 MCP publication 用の bearer token
(`PUBLISHED_MCP_AUTH_TOKEN` / `SANDBOX_HOST_AUTH_TOKEN` / `MCP_AUTH_TOKEN`) は
OIDC consumer 層とは独立した machine-to-machine credential
であり、ここで宣言する `identity.oidc@v1` binding には影響しない。

published MCP tools は session 引数として snake_case と camelCase
の両方を受け付ける。 `session_id` / `sessionId`、`space_id` /
`spaceId`、`user_id` / `userId` の request 値がある場合はそれを使う。省略時は
agent-facing default session として
`session_id=agent-default`、`space_id=published-mcp`、`user_id=takos-agent`
を使う。session 作成時の `space_id` / `spaceId` は container env
`TAKOS_SPACE_ID` に反映され、sandbox 内の Takos API / CLI 操作が対象 space を
判断する fallback context になる。既に起動済みで stopped ではない同一 session
がある場合は既存 session state の space が維持され、後続 request の `space_id` /
`spaceId` では上書きしない。

## Runtime

manifest は `.takosumi/workflows/deploy.yml` の `build-sandbox-host` job から
worker bundle を生成し、`apps/sandbox/Dockerfile` を attached container として
宣言する。tracked reference Workers backend では container class
`SandboxSessionContainer` を `SANDBOX_CONTAINER` binding として worker に渡す。
`compute.web.readiness` は `/readyz` を参照し、container health check は
`/healthz` を参照する。worker route は `/healthz`、`/health`、`/readyz` と
launcher icon の `/icons/computer.svg` も公開する。

## Resources

| resource             | 用途                                        |
| -------------------- | ------------------------------------------- |
| `session-index`      | sandbox session index 用 key-value resource |
| `sandbox-host-token` | worker / sandbox host 間の generated secret |
| `sandbox-mcp-token`  | sandbox MCP proxy 用 generated secret       |

## Scopes

takos-computer は sandbox automation と agent integration のため、office 系
bundled apps より広い Takos API scopes を要求する。default set に含まれても
scope は Takosumi Accounts の AppGrant/AppBinding と operator policy に従って
管理される。旧 `takos.api-key` built-in provider consume は retired。
