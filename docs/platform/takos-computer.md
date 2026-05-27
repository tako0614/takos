# takos-computer

AppSpec examples in this page use short kind names such as `worker`, `gateway`, `postgres`, and `object-store` as operator-profile aliases. URI kind values are also valid. Gateway `listeners` and `routes` live inside the adopted gateway descriptor `spec`; they are not AppSpec core fields.

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
  /readyz                      → readiness endpoint
  /create                      → sandbox session creation
  /session/:id                 → sandbox session state
  /session/:id/mcp             → sandbox MCP proxy
  /icons/computer.svg          → launcher icon
```

## AppSpec (`.takosumi.yml`)

`spec.entrypoint` points to a runtime file inside the resolved source. Managed
install uses the prepared source produced by the build service when that file is
generated; direct Git/local apply is valid only when the file is already present
in the source snapshot.

```yaml
apiVersion: v1

metadata:
  id: jp.takos.computer
  name: Takos Computer
  publisher: takos

components:
  web:
    kind: worker
    spec:
      entrypoint: dist/sandbox-host.js
    listen:
      oidc:
        path: identity.primary.oidc
        kind: identity.oidc@v1
        inject: secret-env
        prefix: OIDC
        required: true

  public:
    kind: gateway
    connect:
      upstream:
        output: web.http
        inject: upstream
    spec:
      listeners:
        public:
          protocol: https
      routes:
        - listener: public
          path: /
          to: upstream
```

gateway は `/` を worker に渡し、worker が
`/mcp`、`/gui`、`/readyz`、`/create`、`/session/:id`、 `/session/:id/mcp`
を処理します。Takos product metadata は launcher / MCP registry / capability
request を登録します。

## MCP authentication

published MCP endpoint の認証には `PUBLISHED_MCP_AUTH_TOKEN` を使います。これは
agent (= MCP client) が `/mcp` を呼ぶときの machine-to-machine bearer token で、
**エンドユーザー認証とは別の layer** です。エンドユーザーの sign-in は AppSpec
の `listen.oidc.path: identity.primary.oidc` 経由で takosumi-cloud が発行する
OIDC consumer flow で処理します。

managed Takos installation では `PUBLISHED_MCP_AUTH_TOKEN`
を自動生成します。他に以下の 2 つの machine token
も内部で使い、それぞれ用途が異なります:

- `SANDBOX_HOST_AUTH_TOKEN` — host admin / session route 用
- `MCP_AUTH_TOKEN` — worker と container の間の認証用

これら 3 つはすべて MCP / sandbox host 内部の machine credential
であり、ユーザー認証 (OIDC consumer 経由) とは完全に分離されています。

## ランタイム

worker bundle は `npm run build` 等で生成されます。 Cloudflare Workers backend
では container class `SandboxSessionContainer` を `SANDBOX_CONTAINER` binding
として worker に渡します。 readiness は `/readyz`、 container health check は
`/healthz` を参照します。

## 関連ページ

- [AppSpec spec](https://takosumi.com/docs/reference/manifest)
- [takosumi.com Official Catalog](https://takosumi.com/docs/reference/catalog)
- [OIDC Consumer](/apps/oidc-consumer)
