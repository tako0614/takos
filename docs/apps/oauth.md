# OAuth

Takos の OAuth client は provider publication として宣言します。app 層の専用
field ではなく、`publish + consume` の 1 例です。

## 基本

```yaml
publish:
  - name: app-oauth
    provider: takos
    kind: oauth-client
    spec:
      clientName: My App
      redirectUris:
        - https://example.com/callback
      scopes:
        - threads:read
        - runs:write

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: app-oauth
        env:
          clientId: OAUTH_CLIENT_ID
          clientSecret: OAUTH_CLIENT_SECRET
          issuer: OAUTH_ISSUER_URL
```

consumer が alias を省略した場合は次の default env 名が使われます。

- `PUBLICATION_APP_OAUTH_CLIENT_ID`
- `PUBLICATION_APP_OAUTH_CLIENT_SECRET`
- `PUBLICATION_APP_OAUTH_ISSUER`

## 利用可能な spec fields

| field                | required | 説明                         |
| -------------------- | -------- | ---------------------------- |
| `clientName`         | no       | 認可画面に表示する client 名 |
| `redirectUris`       | yes      | HTTPS の redirect URI 一覧   |
| `scopes`             | yes      | OAuth scope 一覧             |
| `metadata.logoUri`   | no       | ロゴ URL                     |
| `metadata.tosUri`    | no       | 利用規約 URL                 |
| `metadata.policyUri` | no       | プライバシーポリシー URL     |

## Authorization Code Flow

```text
1. Browser を /oauth/authorize へ送る
2. ユーザーが認可する
3. redirect_uri に code が返る
4. app が /oauth/token で code を交換する
```

```typescript
const response = await fetch("https://takos.example.com/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    grant_type: "authorization_code",
    code,
    client_id: env.OAUTH_CLIENT_ID,
    client_secret: env.OAUTH_CLIENT_SECRET,
    redirect_uri: "https://example.com/callback",
  }),
});
```

## Device Flow

CLI / TV / IoT などブラウザを直接扱えない client では Device Flow を使えます。

```text
1. POST /oauth/device/code
2. verification_uri と user_code をユーザーに提示
3. ユーザーが別端末で認可
4. /oauth/token を polling
```

## スコープ

代表的な scope:

- `threads:read`
- `threads:write`
- `runs:read`
- `runs:write`
- `files:read`
- `files:write`
- `repos:read`
- `repos:write`

必要最小限だけ要求してください。

## refresh token

refresh token は rotation されます。新しい token を保存してから古い token
を破棄してください。

```typescript
const response = await fetch("https://takos.example.com/oauth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.OAUTH_CLIENT_ID,
    client_secret: env.OAUTH_CLIENT_SECRET,
  }),
});
```
