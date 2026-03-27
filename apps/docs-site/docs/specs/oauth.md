# OAuth 2.1 仕様

Revision: 2026-03-26 r1
Status: 確定仕様

Takos の OAuth 実装は **OAuth 2.1** (RFC 9101 系) に準拠し、サードパーティアプリおよび CLI からの安全な API アクセスを提供します。

関連ドキュメント:

- [CLI / Auth model](/specs/cli-and-auth) — CLI 認証の全体像
- [`.takos/app.yml`](/specs/app-manifest) — `spec.oauth` によるクライアント登録

---

## 1. 概要

Takos OAuth は以下の特徴を持ちます。

- **OAuth 2.1 準拠** — Implicit grant を廃止し、すべてのフローで PKCE を必須化
- **Authorization Code + PKCE フロー** — Web アプリ・ネイティブアプリ向け
- **Device Authorization Grant** — CLI / ヘッドレス環境向け
- **動的クライアント登録** — マニフェストからの自動登録をサポート
- **スコープベースのアクセス制御** — 最小権限の原則に基づく細粒度スコープ
- **トークンイントロスペクション** — リソースサーバーによるトークン検証
- **コンセント管理** — ユーザーが許可済みアプリを一覧・取り消し可能

### TAKOS_ACCESS_TOKEN (Managed Token) との違い

Takos には OAuth トークンとは別に、デプロイ時に自動発行される **Managed Token** (`TAKOS_ACCESS_TOKEN`) が存在します。

| | OAuth トークン | TAKOS_ACCESS_TOKEN |
| --- | --- | --- |
| 発行契機 | ユーザーがコンセント画面で許可 | デプロイ時に自動発行 |
| 形式 | `tak_oat_...` (access) / `tak_ort_...` (refresh) | `tak_pat_...` |
| 有効期限 | access: 1 時間 / refresh: 30 日 | デプロイ環境のライフサイクルに従う |
| スコープ制御 | OAuth consent で決定 | `spec.takos.scopes` で宣言 |
| 用途 | サードパーティアプリ・CLI | Worker → Takos API の内部呼び出し |
| 取り消し | ユーザーがコンセント管理から取り消し | 再デプロイで再発行 |

OAuth はユーザーの代理として外部アプリが API を呼ぶ仕組みであり、`TAKOS_ACCESS_TOKEN` はデプロイされた Worker が自身の権限で API を呼ぶ仕組みです。

---

## 2. Authorization Code + PKCE フロー

Web アプリおよびネイティブアプリ向けの標準フローです。OAuth 2.1 に従い、**すべてのクライアントで PKCE が必須**です。

### シーケンス

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  Client  │     │  Takos Auth  │     │    User      │
│  (App)   │     │  Server      │     │  (Browser)   │
└────┬─────┘     └──────┬───────┘     └──────┬───────┘
     │                  │                    │
     │  1. code_verifier = random(43..128)   │
     │  2. code_challenge = SHA256(verifier)  │
     │                  │                    │
     │  3. GET /oauth/authorize              │
     │  ?response_type=code                  │
     │  &client_id=...                       │
     │  &redirect_uri=...                    │
     │  &scope=openid profile               │
     │  &state=...                           │
     │  &code_challenge=...                  │
     │  &code_challenge_method=S256          │
     │─────────────────>│                    │
     │                  │  4. コンセント画面   │
     │                  │───────────────────>│
     │                  │                    │
     │                  │  5. ユーザー許可    │
     │                  │<───────────────────│
     │                  │                    │
     │  6. 302 redirect_uri                  │
     │  ?code=AUTH_CODE&state=...            │
     │<─────────────────│                    │
     │                  │                    │
     │  7. POST /oauth/token                 │
     │  grant_type=authorization_code        │
     │  &code=AUTH_CODE                      │
     │  &redirect_uri=...                    │
     │  &client_id=...                       │
     │  &code_verifier=...                   │
     │─────────────────>│                    │
     │                  │                    │
     │  8. { access_token, refresh_token,    │
     │       expires_in, token_type }        │
     │<─────────────────│                    │
     └──────────────────┴────────────────────┘
```

### 認可リクエスト

```http
GET /oauth/authorize?response_type=code
  &client_id=CLIENT_ID
  &redirect_uri=https://app.example.com/callback
  &scope=openid+profile+spaces:read
  &state=RANDOM_STATE
  &code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
  &code_challenge_method=S256
```

| パラメータ | 必須 | 説明 |
| --- | --- | --- |
| `response_type` | yes | `code` 固定 |
| `client_id` | yes | 登録済みクライアント ID |
| `redirect_uri` | yes | 登録済みリダイレクト URI |
| `scope` | yes | スペース区切りのスコープ |
| `state` | yes | CSRF 防止用ランダム値 |
| `code_challenge` | yes | PKCE チャレンジ (BASE64URL(SHA256(verifier))) |
| `code_challenge_method` | yes | `S256` 固定 (plain は拒否) |

### トークンリクエスト

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=AUTH_CODE
&redirect_uri=https://app.example.com/callback
&client_id=CLIENT_ID
&code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

### トークンレスポンス

```json
{
  "access_token": "tak_oat_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "tak_ort_...",
  "scope": "openid profile spaces:read"
}
```

### トークンリフレッシュ

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=tak_ort_...
&client_id=CLIENT_ID
```

---

## 3. デバイスフロー (CLI 用)

ブラウザを直接操作できない CLI やヘッドレス環境向けの Device Authorization Grant (RFC 8628) です。

### シーケンス

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  CLI     │     │  Takos Auth  │     │    User      │
│          │     │  Server      │     │  (Browser)   │
└────┬─────┘     └──────┬───────┘     └──────┬───────┘
     │                  │                    │
     │  1. POST /oauth/device/code           │
     │  client_id=CLI_CLIENT_ID              │
     │  &scope=openid profile                │
     │─────────────────>│                    │
     │                  │                    │
     │  2. { device_code, user_code,         │
     │       verification_uri,               │
     │       verification_uri_complete,      │
     │       expires_in: 900,                │
     │       interval: 5 }                   │
     │<─────────────────│                    │
     │                  │                    │
     │  3. ユーザーに表示:                     │
     │  "https://takos.dev/device を開いて    │
     │   コード ABCD-EFGH を入力してください"   │
     │                  │                    │
     │                  │  4. ユーザーがブラウザ │
     │                  │  で verification_uri │
     │                  │  を開き user_code を │
     │                  │  入力               │
     │                  │<───────────────────│
     │                  │                    │
     │                  │  5. コンセント画面   │
     │                  │───────────────────>│
     │                  │                    │
     │                  │  6. ユーザー許可    │
     │                  │<───────────────────│
     │                  │                    │
     │  7. POST /oauth/token (ポーリング)     │
     │  grant_type=                          │
     │    urn:ietf:params:oauth:             │
     │    grant-type:device_code             │
     │  &device_code=DEVICE_CODE             │
     │  &client_id=CLI_CLIENT_ID             │
     │─────────────────>│                    │
     │                  │                    │
     │  (承認前: 400 authorization_pending)   │
     │  (承認後:)                             │
     │  8. { access_token, refresh_token,    │
     │       expires_in, token_type }        │
     │<─────────────────│                    │
     └──────────────────┴────────────────────┘
```

### デバイスコードリクエスト

```http
POST /oauth/device/code
Content-Type: application/x-www-form-urlencoded

client_id=CLI_CLIENT_ID
&scope=openid+profile+spaces:read+spaces:write
```

### デバイスコードレスポンス

```json
{
  "device_code": "GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS",
  "user_code": "ABCD-EFGH",
  "verification_uri": "https://takos.dev/device",
  "verification_uri_complete": "https://takos.dev/device?user_code=ABCD-EFGH",
  "expires_in": 900,
  "interval": 5
}
```

### ポーリング

CLI は `interval` (5 秒) 間隔でトークンエンドポイントをポーリングします。

```http
POST /oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=urn:ietf:params:oauth:grant-type:device_code
&device_code=GmRhmhcxhwAzkoEqiMEg_DnyEysNkuNhszIySk9eS
&client_id=CLI_CLIENT_ID
```

ポーリング中のエラーレスポンス:

| error | 意味 |
| --- | --- |
| `authorization_pending` | ユーザーがまだ認可していない。ポーリングを継続 |
| `slow_down` | ポーリング間隔が短すぎる。interval を 5 秒加算 |
| `expired_token` | device_code が期限切れ (15 分)。フローを最初からやり直し |
| `access_denied` | ユーザーが拒否した |

---

## 4. スコープ一覧

スコープはリソース単位で `read` / `write` に分かれます。`write` は `read` を包含しません (明示的に両方を要求する必要があります)。

### Identity スコープ

| スコープ | 説明 |
| --- | --- |
| `openid` | OpenID Connect の ID トークンを要求 |
| `profile` | ユーザーのプロフィール情報 (表示名、アバター等) |
| `email` | ユーザーのメールアドレス |

### Resource スコープ

| スコープ | 説明 |
| --- | --- |
| `spaces:read` | Space の一覧・詳細の取得 |
| `spaces:write` | Space の作成・更新・削除 |
| `files:read` | ファイルの一覧・ダウンロード |
| `files:write` | ファイルのアップロード・削除 |
| `memories:read` | Memory の一覧・検索・取得 |
| `memories:write` | Memory の作成・更新・削除 |
| `threads:read` | Thread の一覧・詳細・メッセージ取得 |
| `threads:write` | Thread の作成・メッセージ送信 |
| `repos:read` | リポジトリの一覧・詳細・ファイル取得 |
| `repos:write` | リポジトリの作成・更新・削除 |

### Execution スコープ

| スコープ | 説明 |
| --- | --- |
| `agents:execute` | エージェントの実行 (Run の作成・制御) |

### スコープの組み合わせ例

```
# 読み取り専用ダッシュボード
openid profile spaces:read threads:read

# エージェント実行アプリ
openid profile spaces:read threads:read threads:write agents:execute

# フルアクセス CLI
openid profile email spaces:read spaces:write files:read files:write memories:read memories:write threads:read threads:write agents:execute repos:read repos:write
```

---

## 5. クライアント登録

### 動的クライアント登録

サードパーティアプリは OAuth Dynamic Client Registration (RFC 7591) に基づいてクライアントを登録できます。

```http
POST /oauth/register
Content-Type: application/json

{
  "client_name": "My Dashboard App",
  "redirect_uris": ["https://app.example.com/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "openid profile spaces:read"
}
```

レスポンス:

```json
{
  "client_id": "tak_client_a1b2c3d4e5f6",
  "client_name": "My Dashboard App",
  "redirect_uris": ["https://app.example.com/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "none",
  "scope": "openid profile spaces:read",
  "client_id_issued_at": 1711411200
}
```

### マニフェストからの自動登録

`.takos/app.yml` の `spec.oauth` フィールドにより、デプロイ時に OAuth クライアントが自動登録されます。

```yaml
apiVersion: takos.dev/v1alpha1
kind: Package
metadata:
  name: my-dashboard
spec:
  version: "1.0.0"
  oauth:
    client_name: My Dashboard
    redirect_uris:
      - /callback
    scopes:
      - openid
      - profile
      - spaces:read
      - threads:read
```

デプロイ時に相対パスの `redirect_uris` は Endpoint の URL を基準に解決されます。

---

## 6. トークンイントロスペクション

リソースサーバーは受け取ったアクセストークンの有効性を検証できます (RFC 7662)。

```http
POST /oauth/introspect
Content-Type: application/x-www-form-urlencoded
Authorization: Bearer <resource_server_token>

token=tak_oat_...
```

### アクティブなトークンのレスポンス

```json
{
  "active": true,
  "scope": "openid profile spaces:read",
  "client_id": "tak_client_a1b2c3d4e5f6",
  "username": "tako",
  "token_type": "Bearer",
  "exp": 1711414800,
  "iat": 1711411200,
  "sub": "user_abc123",
  "iss": "https://takos.dev"
}
```

### 無効なトークンのレスポンス

```json
{
  "active": false
}
```

トークンが期限切れ、取り消し済み、または不正な場合は常に `{"active": false}` が返されます。

---

## 7. コンセント管理

ユーザーは許可済みの OAuth アプリを一覧表示し、個別にアクセスを取り消すことができます。

### 許可済みアプリの一覧

```http
GET /api/me/oauth/consents
Authorization: Bearer <user_token>
```

```json
{
  "consents": [
    {
      "id": "consent_abc123",
      "client_id": "tak_client_a1b2c3d4e5f6",
      "client_name": "My Dashboard App",
      "scopes": ["openid", "profile", "spaces:read"],
      "granted_at": "2026-03-20T10:00:00Z",
      "last_used_at": "2026-03-26T08:30:00Z"
    }
  ]
}
```

### コンセントの取り消し

```http
DELETE /api/me/oauth/consents/:consent_id
Authorization: Bearer <user_token>
```

取り消しを行うと:

1. 該当クライアントに発行されたすべてのアクセストークンが即座に無効化される
2. 該当クライアントに発行されたすべてのリフレッシュトークンが無効化される
3. クライアントは再度コンセントフローを通る必要がある

---

## 8. 監査ログ

OAuth に関連するすべてのアクションは監査ログに記録されます。

### 記録されるイベント

| イベント | 説明 |
| --- | --- |
| `oauth.authorize` | 認可コードの発行 |
| `oauth.token.issued` | アクセストークンの発行 |
| `oauth.token.refreshed` | トークンのリフレッシュ |
| `oauth.token.revoked` | トークンの取り消し |
| `oauth.consent.granted` | コンセントの許可 |
| `oauth.consent.revoked` | コンセントの取り消し |
| `oauth.client.registered` | クライアントの登録 |
| `oauth.device.authorized` | デバイスフローの認可 |
| `oauth.introspect` | トークンイントロスペクション |

### 監査ログの取得

```http
GET /api/spaces/:space_id/audit-logs?category=oauth
Authorization: Bearer <user_token>
```

```json
{
  "entries": [
    {
      "id": "log_xyz789",
      "event": "oauth.token.issued",
      "actor": "user_abc123",
      "client_id": "tak_client_a1b2c3d4e5f6",
      "scopes": ["openid", "profile", "spaces:read"],
      "ip": "203.0.113.1",
      "timestamp": "2026-03-26T08:30:00Z"
    }
  ]
}
```

---

## 9. トークンライフサイクル定数

| 項目 | 値 | 説明 |
| --- | --- | --- |
| アクセストークン有効期限 | **3600 秒 (1 時間)** | 期限切れ後はリフレッシュが必要 |
| リフレッシュトークン有効期限 | **30 日** | 期限切れ後は再認可が必要 |
| 認可コード有効期限 | **600 秒 (10 分)** | 発行後速やかにトークン交換すること |
| デバイスコード有効期限 | **900 秒 (15 分)** | 期限切れ後はフローを再開始 |
| デバイスポーリング間隔 | **5 秒** | `slow_down` 受信時は +5 秒 |

---

## 10. エンドポイント一覧

| エンドポイント | メソッド | 説明 |
| --- | --- | --- |
| `/oauth/authorize` | GET | 認可エンドポイント |
| `/oauth/token` | POST | トークンエンドポイント |
| `/oauth/device/code` | POST | デバイスコード発行 |
| `/oauth/register` | POST | 動的クライアント登録 |
| `/oauth/introspect` | POST | トークンイントロスペクション |
| `/oauth/revoke` | POST | トークン取り消し (RFC 7009) |
| `/.well-known/openid-configuration` | GET | OpenID Connect Discovery |
| `/.well-known/oauth-authorization-server` | GET | OAuth Authorization Server Metadata |

### Discovery レスポンス例

```json
{
  "issuer": "https://takos.dev",
  "authorization_endpoint": "https://takos.dev/oauth/authorize",
  "token_endpoint": "https://takos.dev/oauth/token",
  "device_authorization_endpoint": "https://takos.dev/oauth/device/code",
  "registration_endpoint": "https://takos.dev/oauth/register",
  "introspection_endpoint": "https://takos.dev/oauth/introspect",
  "revocation_endpoint": "https://takos.dev/oauth/revoke",
  "scopes_supported": [
    "openid", "profile", "email",
    "spaces:read", "spaces:write",
    "files:read", "files:write",
    "memories:read", "memories:write",
    "threads:read", "threads:write",
    "agents:execute",
    "repos:read", "repos:write"
  ],
  "response_types_supported": ["code"],
  "grant_types_supported": [
    "authorization_code",
    "refresh_token",
    "urn:ietf:params:oauth:grant-type:device_code"
  ],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["none", "client_secret_post"]
}
```
