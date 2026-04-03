# OAuth

app.yml に `spec.oauth` を書くと、OAuth client が自動登録される。deploy 時に control plane が client credentials を発行し、Worker / Container に環境変数として注入します。

## 基本設定

```yaml
spec:
  oauth:
    clientName: My App
    redirectUris:
      - https://example.com/callback
    scopes:
      - threads:read
      - runs:write
    autoEnv: true
```

`autoEnv: true` にすると、以下の環境変数が Worker / Container に自動注入される。

| 環境変数名 | 内容 |
| --- | --- |
| `OAUTH_CLIENT_ID` | 登録された OAuth client ID |
| `OAUTH_CLIENT_SECRET` | 登録された OAuth client secret |

::: tip autoEnv を使わない場合
`autoEnv: false` にすると環境変数の自動注入を無効にできます。client credentials は control plane 内に保存されるので、API 経由で取得して独自に管理することも可能です。
:::

## 認可フロー

Takos の OAuth は Authorization Code Flow をサポートしています。

```text
1. ユーザーが認可画面にアクセス
   GET /oauth/authorize?client_id=...&redirect_uri=...&scope=...&response_type=code

2. ユーザーが認可を承認

3. redirect_uri にコード付きでリダイレクト
   https://example.com/callback?code=AUTH_CODE

4. アプリがコードをトークンに交換
   POST /oauth/token
   { grant_type: "authorization_code", code: AUTH_CODE, client_id: ..., client_secret: ... }

5. アクセストークンを取得
   { access_token: "...", token_type: "bearer", expires_in: 3600, refresh_token: "..." }
```

## スコープ設定

`scopes` でアプリが要求する権限を宣言します。ユーザーには認可画面でスコープの内容が表示されます。

### 利用可能なスコープ

| スコープ | 説明 |
| --- | --- |
| `threads:read` | スレッド閲覧 |
| `threads:write` | スレッド作成・更新 |
| `runs:read` | 実行結果閲覧 |
| `runs:write` | 実行開始 |
| `files:read` | ファイル閲覧 |
| `files:write` | ファイルアップロード・削除 |
| `repos:read` | リポジトリ閲覧 |
| `repos:write` | リポジトリ作成・更新 |

::: info スコープの粒度
必要最小限のスコープだけを要求してください。過剰なスコープは認可画面でユーザーの不安を招きます。
:::

### スコープの指定例

```yaml
# 読み取りのみ
scopes:
  - threads:read
  - runs:read

# 読み書き両方
scopes:
  - threads:read
  - threads:write
  - runs:read
  - runs:write
```

## トークンの取り扱い

### アクセストークン

アクセストークンは Bearer トークンとして API リクエストに付与します。

```typescript
const response = await fetch("https://takos.example.com/api/threads", {
  headers: {
    Authorization: `Bearer ${accessToken}`,
  },
});
```

### トークンのリフレッシュ

アクセストークンの有効期限が切れた場合、refresh token を使って新しいトークンを取得します。

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

const { access_token, refresh_token, expires_in } = await response.json();
```

::: tip
refresh token は 1 回限り有効です。リフレッシュ時に新しい refresh token が返されるので、必ず保存してください。
:::

## metadata

OAuth client に追加のメタデータを設定できる。ロゴ画像や利用規約・プライバシーポリシーの URL など。

```yaml
spec:
  oauth:
    clientName: My App
    redirectUris: [https://example.com/callback]
    scopes: [threads:read]
    autoEnv: true
    metadata:
      logoUri: https://example.com/logo.png
      tosUri: https://example.com/terms
      policyUri: https://example.com/privacy
```

| field | 説明 |
| --- | --- |
| `logoUri` | OAuth 認可画面に表示するロゴ画像の URL |
| `tosUri` | 利用規約ページの URL |
| `policyUri` | プライバシーポリシーページの URL |

## エラーハンドリング

OAuth フローで発生しうるエラーとその対処を示します。

| エラー | 原因 | 対処 |
| --- | --- | --- |
| `invalid_client` | client ID / secret が不正 | `autoEnv` で注入された値を確認。再 apply で再生成 |
| `invalid_grant` | 認可コードが無効または期限切れ | ユーザーに再認可を求める |
| `invalid_scope` | 要求スコープが不正 | `app.yml` の `scopes` と一致しているか確認 |
| `access_denied` | ユーザーが認可を拒否 | アプリ側でキャンセル時の UI を用意する |
| `unauthorized_client` | redirect URI が未登録 | `redirectUris` に正しい URL を追加 |

```typescript
// エラーレスポンスの処理例
const params = new URL(request.url).searchParams;
const error = params.get("error");

if (error) {
  const description = params.get("error_description") ?? "Unknown error";
  // ユーザーにエラーを表示
  return new Response(`OAuth error: ${error} - ${description}`, {
    status: 400,
  });
}
```

## 完全な設定例

```yaml
apiVersion: takos.dev/v1alpha1
kind: App
metadata:
  name: my-oauth-app
spec:
  version: 1.0.0

  oauth:
    clientName: My OAuth App
    redirectUris:
      - https://my-app.example.com/callback
      - http://localhost:3000/callback   # ローカル開発用
    scopes:
      - threads:read
      - threads:write
      - runs:read
    autoEnv: true
    metadata:
      logoUri: https://my-app.example.com/logo.png
      tosUri: https://my-app.example.com/terms
      policyUri: https://my-app.example.com/privacy

  workers:
    web:
      build:
        fromWorkflow:
          path: .takos/workflows/deploy.yml
          job: bundle
          artifact: web
          artifactPath: dist/worker

  routes:
    - name: app
      target: web
      path: /
```

::: tip ローカル開発
`redirectUris` に `http://localhost:*` を追加しておくと、ローカル開発時にも OAuth フローをテストできます。本番 deploy 前に不要な URI を削除してください。
:::

## 関連ページ

- [MCP Server](/apps/mcp) --- MCP endpoint の公開
- [環境変数](/apps/environment) --- 環境変数の管理
- [app.yml](/apps/manifest) --- manifest の全体像
- [CLI 認証](/reference/cli-auth) --- CLI の認証方法
