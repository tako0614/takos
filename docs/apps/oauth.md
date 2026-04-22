# OAuth

Takos の OAuth client は `takos.oauth-client` system publication source を
`compute.<name>.consume` で request して受け取ります。group 層の専用 field
ではなく、他の publication と同じ publish / consume contract の一部です。
未知の `request` field は deploy validation で invalid です。

## 基本

```yaml
compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker
    consume:
      - publication: takos.oauth-client
        as: app-oauth
        request:
          clientName: My App
          redirectUris:
            - https://example.com/callback
          scopes:
            - threads:read
            - runs:write
        env:
          clientId: OAUTH_CLIENT_ID
          clientSecret: OAUTH_CLIENT_SECRET
          issuer: OAUTH_ISSUER_URL
```

consumer が alias を省略した場合は次の default env 名が使われます。

- `PUBLICATION_APP_OAUTH_CLIENT_ID`
- `PUBLICATION_APP_OAUTH_CLIENT_SECRET`
- `PUBLICATION_APP_OAUTH_ISSUER`

## 利用可能な request fields

| field                | required | 説明                                                                                                                |
| -------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- |
| `redirectUris`       | yes      | HTTPS の redirect URI 一覧。manifest では `/api/auth/callback` のような相対 path も可                               |
| `scopes`             | yes      | OAuth scope 一覧                                                                                                    |
| `clientName`         | no       | 認可画面に表示する client 名                                                                                        |
| `metadata.logoUri`   | no       | ロゴ URL                                                                                                            |
| `metadata.tosUri`    | no       | 利用規約 URL                                                                                                        |
| `metadata.policyUri` | no       | プライバシーポリシー URL                                                                                            |

相対 `redirectUris` は manifest deploy 時に group の auto hostname へ解決されます。
そのため `TENANT_BASE_DOMAIN` と space / group slug から hostname を解決できない
環境では deploy validation が失敗します。API から OAuth client を直接作る場合は、
相対 path ではなく絶対 HTTPS URL を渡してください。local development では
`localhost`, `127.0.0.1`, `[::1]`, `.localhost` の HTTP URI も受け付けます。

`clientName` と `metadata.*` は optional です。`metadata` 配下は `logoUri` /
`tosUri` / `policyUri` を受け付けます。

## Authorization Code Flow

```text
1. Browser を /oauth/authorize へ送る（PKCE S256 の code_challenge を付与する）
2. ユーザーが認可する
3. redirect_uri に code が返る
4. group が /oauth/token で code を交換する（code_verifier を送る）
```

```typescript
const response = await fetch("https://takos.example.com/oauth/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "authorization_code",
    code,
    client_id: env.OAUTH_CLIENT_ID,
    client_secret: env.OAUTH_CLIENT_SECRET,
    redirect_uri: "https://example.com/callback",
    code_verifier,
  }),
});
```

## Device Flow

Device Flow は Takos OAuth server が support する grant type です。ただし
`.takos/app.yml` の `takos.oauth-client` consume request で作る client は
Authorization Code Flow と refresh token を前提にします。Device Flow を使う client は Dynamic
Client Registration などで `grant_types` に
`urn:ietf:params:oauth:grant-type:device_code` を含めて登録してください。

CLI / TV / IoT などブラウザを直接扱えない client では、次の流れで使います。

```text
1. POST /oauth/device/code で device_code / user_code を発行する
2. verification_uri と user_code をユーザーに提示
3. ユーザーが別端末で認可
4. interval 以上の間隔で /oauth/token を polling
```

device authorization request:

```typescript
const response = await fetch("https://takos.example.com/oauth/device/code", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    client_id: clientId,
    // confidential client の場合だけ送る
    client_secret: clientSecret,
    scope: "threads:read runs:write",
  }),
});
```

response:

```json
{
  "device_code": "device-code",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://takos.example.com/oauth/device",
  "verification_uri_complete": "https://takos.example.com/oauth/device?user_code=ABCD-EFGH",
  "expires_in": 900,
  "interval": 5
}
```

token polling:

```typescript
const response = await fetch("https://takos.example.com/oauth/token", {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    device_code: deviceCode,
    client_id: clientId,
    // confidential client の場合だけ送る
    client_secret: clientSecret,
  }),
});
```

未認可の間は `authorization_pending`、polling が早すぎる場合は `slow_down`
が返ります。ユーザーが拒否した場合は `access_denied`、期限切れは
`expired_token`、使用済みまたは無効な code は `invalid_grant` です。

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
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
  },
  body: new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.OAUTH_CLIENT_ID,
    client_secret: env.OAUTH_CLIENT_SECRET,
  }),
});
```
