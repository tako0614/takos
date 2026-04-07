# OAuth

app.yml に `oauth` を書くと、OAuth client が自動登録される。deploy 時に control plane が client credentials を発行し、Worker / Container に環境変数として注入します。

## 基本設定

```yaml
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
`autoEnv: false` にすると環境変数の自動注入を無効にできます。client credentials は control plane 内に保存されるので、admin UI から取得して独自に secret として管理してください。`autoEnv: false` の場合は CI / runtime 側で `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` を手動で設定する必要があります。
:::

## 認可フロー

Takos の OAuth は次の 2 種類のフローをサポートしています。

- **Authorization Code Flow** --- ブラウザ経由でユーザーが認可するアプリ向け
- **Device Authorization Grant (Device Flow)** --- ブラウザを直接操作できないクライアント (CLI / TV / IoT など) 向け

::: info CLI login との違い
`takos login` 自体はブラウザコールバック方式で実装されており、ここで説明する Device Flow を使いません。Device Flow は `app.yml` で OAuth client を登録した **サードパーティアプリ** が、自身の CLI / IoT クライアントから takos に対してユーザー認可を取得するためのフローです。詳細は [CLI / Auth model](/reference/cli-auth#認証) を参照してください。
:::

### Authorization Code Flow

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

### Device Authorization Grant (Device Flow)

ブラウザを直接呼び出せないクライアント (CLI / TV / IoT 端末など) のためのフローです。RFC 8628 に準拠しています。

```text
1. クライアントが device code を要求
   POST /oauth/device/code
   { client_id: "...", scope: "threads:read runs:write" }

   レスポンス:
   {
     "device_code": "...",
     "user_code": "ABCD-EFGH",
     "verification_uri": "https://takos.example.com/oauth/device",
     "verification_uri_complete": "https://takos.example.com/oauth/device?user_code=ABCD-EFGH",
     "expires_in": 600,
     "interval": 5
   }

2. クライアントがユーザーに verification_uri と user_code を提示
   "https://takos.example.com/oauth/device を開いて ABCD-EFGH を入力してください"

3. ユーザーが別端末のブラウザで verification_uri を開いて user_code を入力し認可

4. クライアントが interval 秒ごとに /oauth/token をポーリング
   POST /oauth/token
   {
     grant_type: "urn:ietf:params:oauth:grant-type:device_code",
     device_code: "...",
     client_id: "..."
   }

   ユーザーが未認可の間は { "error": "authorization_pending" } が返る

5. ユーザーが認可するとアクセストークンが返る
   { access_token: "...", token_type: "bearer", expires_in: 3600, refresh_token: "..." }
```

ポーリング時に返り得るエラーコード:

| エラー                  | 意味                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `authorization_pending` | ユーザーがまだ認可していない。`interval` 秒待って再ポーリング       |
| `slow_down`             | ポーリングが速すぎる。`interval` を 5 秒延長して再ポーリング        |
| `expired_token`         | `device_code` が `expires_in` を超過。新しい device code を取得する |
| `access_denied`         | ユーザーが認可を拒否                                                |

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
name: my-oauth-app

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

compute:
  web:
    build:
      fromWorkflow:
        path: .takos/workflows/deploy.yml
        job: bundle
        artifact: web
        artifactPath: dist/worker

routes:
  - target: web
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
