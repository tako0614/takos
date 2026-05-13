# takos-computer

> このページでわかること: バンドルアプリ takos-computer の概要。

ブラウザ自動操作とサンドボックスコンピューターを提供するアプリです。

## 役割

- sandbox session の作成・管理
- browser / computer automation 用の UI surface
- agent が直接使える published MCP tool surface
- session ごとの MCP proxy endpoint
- Cloudflare Workers + attached container で sandbox runtime を起動
- kernel の Storage / Memory / Thread / Run / Repository / MCP API に built-in
  provider consume 経由でアクセス

## Takosumi 上での動作

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

launcher / MCP endpoint は kernel manifest ではなく Takos の app catalog /
MCP registry が管理する metadata です。`/mcp` は `computer_shell_exec` /
`computer_file_read` / `computer_file_write` などの `computer_*` tool を
公開し、必要に応じて sandbox session を作って `/session/:id/mcp` に proxy
します。Takos API へのアクセスは app-layer の grant から materialize されます。

published MCP endpoint の認証には `PUBLISHED_MCP_AUTH_TOKEN` を使います。これは
agent (= MCP client) が `/mcp` を呼ぶときの machine-to-machine bearer token で、
**エンドユーザー認証とは別の layer** です。エンドユーザーの sign-in は
`identity.oidc@v1` AppBinding (Takosumi Accounts) 経由の OIDC consumer flow で
処理します。

managed Takos installation では `PUBLISHED_MCP_AUTH_TOKEN` を自動生成します。
他に以下の 2 つの machine token も内部で使い、それぞれ用途が異なります:

- `SANDBOX_HOST_AUTH_TOKEN` — host admin / session route 用
- `MCP_AUTH_TOKEN` — worker と container の間の認証用

これら 3 つはすべて MCP / sandbox host 内部の machine credential であり、
ユーザー認証 (OIDC consumer 経由) とは完全に分離されています。

## Bindings

takos-computer は他のバンドルアプリと同じく **OIDC consumer** です。エンド
ユーザーの sign-in は Takosumi Accounts に委譲します。

`.takosumi/app.yml` に `identity.oidc@v1` AppBinding を宣言すると、installer
(takosumi-git) が installation ごとの OIDC client を Takosumi Accounts に登録し、
`OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI`
を runtime に渡します。詳細は [OIDC Consumer](/apps/oidc-consumer) と
[Binding Catalog](https://github.com/tako0614/takosumi-git/blob/master/docs/reference/binding-catalog.md#_1-identity-oidc-v1)
を参照してください。

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

OIDC callback path は `/gui/api/auth/callback` を使います。takos-computer 自身は
OAuth provider にならず、OIDC issuer は常に Takosumi Accounts です。セルフホスト
オペレーターが Keycloak / Authentik 等を使う場合も、それらは Takosumi Accounts
の upstream IdP として接続します。

MCP の bearer token (`PUBLISHED_MCP_AUTH_TOKEN` / `SANDBOX_HOST_AUTH_TOKEN` /
`MCP_AUTH_TOKEN`) は OIDC consumer 層とは独立した machine-to-machine credential
で、`identity.oidc@v1` binding には影響しません。

published MCP tools は session 引数として snake_case と camelCase の両方を
受け付けます。`session_id` / `sessionId`、`space_id` / `spaceId`、`user_id` /
`userId` のリクエスト値があればそれを使い、省略時はデフォルト session
(`session_id=agent-default`、`space_id=published-mcp`、`user_id=takos-agent`)
を使います。

session 作成時の `space_id` / `spaceId` は container env `TAKOS_SPACE_ID` に
反映され、sandbox 内の Takos API / CLI が参照する space になります。すでに同じ
session が動いている場合は、既存 session の space が維持され、後続リクエストの
`space_id` / `spaceId` で上書きされません。

## ランタイム

manifest は `.takosumi/workflows/deploy.yml` の `build-sandbox-host` job から
worker bundle を生成し、`apps/sandbox/Dockerfile` を attached container として
宣言します。Cloudflare Workers backend では container class
`SandboxSessionContainer` を `SANDBOX_CONTAINER` binding として worker に渡します。
readiness は `/readyz`、container health check は `/healthz` を参照します。
worker route は `/healthz` / `/health` / `/readyz` とランチャーアイコン
`/icons/computer.svg` も公開します。

## Resources

| resource             | 用途                                        |
| -------------------- | ------------------------------------------- |
| `session-index`      | sandbox session index 用 key-value resource |
| `sandbox-host-token` | worker / sandbox host 間の generated secret |
| `sandbox-mcp-token`  | sandbox MCP proxy 用 generated secret       |

## スコープ

takos-computer は sandbox automation と agent 統合のため、office 系バンドル
アプリよりも広い Takos API scope を要求します。scope は Takosumi Accounts の
AppGrant / AppBinding と operator policy に従って管理されます。
