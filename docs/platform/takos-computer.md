# takos-computer

> このページでわかること: バンドルアプリ takos-computer の概要。

ブラウザ自動操作とサンドボックスコンピューターを提供するアプリです。

## 役割

- sandbox session の作成・管理
- browser / computer automation 用の UI surface
- agent が直接使える published MCP tool surface
- セッションごとの MCP proxy endpoint
- Cloudflare Workers + attached container で sandbox runtime を host
- Takosumi Accounts OIDC consumer

## Takosumi 上での動作

hostname は routing layer が割り当てる。

- auto: `{space-slug}-{installation-slug}.{TENANT_BASE_DOMAIN}`
- custom slug / custom domain もオプションで設定可能

```text
{hostname}
  /mcp                         → published MCP endpoint for agents
  /gui                         → dashboard / computer UI
  /gui/api/auth/callback       → OIDC callback (Takosumi Accounts 経由)
  /healthz                     → liveness health check
  /health                      → health alias
  /readyz                      → readiness check
  /create                      → sandbox session creation
  /session/:id                 → sandbox session state
  /session/:id/mcp             → sandbox MCP proxy
  /icons/computer.svg          → launcher icon
```

## AppSpec (`.takosumi.yml`)

```yaml
apiVersion: takosumi.dev/v1

metadata:
  id: jp.takos.computer
  name: Takos Computer
  publisher: takos

components:
  web:
    kind: worker
    build:
      command: deno task build
      output: dist/worker.mjs
    routes:
      - /mcp
      - /gui
      - /gui/*
      - /gui/api/auth/*
      - /healthz
      - /health
      - /readyz
      - /create
      - /session
      - /session/:id
      - /session/:id/mcp
      - /icons/computer.svg
    listen:
      operator.identity.oidc:
        as: env

interfaces:
  launch:
    target: web
    path: /gui/api/auth/launch
  mcp:
    target: web
    path: /mcp
  health:
    target: web
    path: /readyz

permissions:
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
    - logs.read.own
```

## MCP authentication

published MCP endpoint の認証には `PUBLISHED_MCP_AUTH_TOKEN` を使います。これは
agent (= MCP client) が `/mcp` を呼ぶときの machine-to-machine bearer token で、
**エンドユーザー認証とは別の layer** です。 エンドユーザーの sign-in は AppSpec の
`listen: { operator.identity.oidc: { as: env } }` 経由で takosumi-cloud が provider
として発行する OIDC consumer flow で処理します。

managed Takos installation では `PUBLISHED_MCP_AUTH_TOKEN` を自動生成します。
他に以下の 2 つの machine token も内部で使い、 それぞれ用途が異なります:

- `SANDBOX_HOST_AUTH_TOKEN` — host admin / session route 用
- `MCP_AUTH_TOKEN` — worker と container の間の認証用

これら 3 つはすべて MCP / sandbox host 内部の machine credential であり、
ユーザー認証 (OIDC consumer 経由) とは完全に分離されています。

## ランタイム

worker bundle は `npm run build` 等で生成されます。 Cloudflare Workers backend
では container class `SandboxSessionContainer` を `SANDBOX_CONTAINER` binding
として worker に渡します。 readiness は `/readyz`、 container health check は
`/healthz` を参照します。

## 関連ページ

- [AppSpec spec](https://github.com/tako0614/takosumi/blob/master/docs/reference/app-spec.md)
- [Component Kind Catalog](https://github.com/tako0614/takosumi/blob/master/docs/reference/component-kind-catalog.md)
- [OIDC Consumer](/apps/oidc-consumer)
