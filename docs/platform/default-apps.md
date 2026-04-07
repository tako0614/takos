# Default Groups

Takos には 4 つの default group が付属する。
space template により preinstall されるが、削除・差し替えできる。

> **重要**: Agent / Chat / Git / Storage / Store は kernel 機能であり、
> default group には含まれない。これらは kernel に常設され uninstall 不可。
> 一方、下記の 4 つの default group は外部 app として deploy され、
> 削除・差し替えが可能。

## 一覧

default group は以下の 4 つのみ（Agent / Chat / Git / Storage / Store は
kernel 機能のため含まれない）:

| group | 役割 | publications |
| --- | --- | --- |
| [takos-computer](/platform/takos-computer) | ブラウザ自動化 / サンドボックス | UiSurface, McpServer |
| [takos-docs](/platform/takos-docs) | リッチテキストエディタ | UiSurface, McpServer |
| [takos-excel](/platform/takos-excel) | スプレッドシート | UiSurface, McpServer |
| [takos-slide](/platform/takos-slide) | プレゼンテーション | UiSurface, McpServer |

## 動作原理

各 group は独立した worker として deploy される。
- 自前の sql/object-store で data を管理
- 自前の HTTP API を expose
- kernel の auth (`/auth/*`) を使って認証
- env injection で他 group の URL を得る
- kernel の API を経由せず直接アクセス可能

kernel は各 group の `type: UiSurface` publication を把握しており、
sidebar + iframe で統合表示する。各 group は standalone でも動作する。

## URL 体系

kernel は `{KERNEL_DOMAIN}` で serve し、各 group は独自の hostname を持つ。

```text
Kernel ({KERNEL_DOMAIN}):
  /                      → kernel (agent/chat + dashboard)
  /api/*                 → kernel API
  /auth/*                → kernel auth
  /settings              → kernel settings

Groups (routing layer で hostname 割り当て):
  group は最大 3 つの hostname を持てる:

  1. auto:          {space-slug}-{group-slug}.{TENANT_BASE_DOMAIN}（常に存在、衝突しない）
  2. custom slug:   {custom-slug}.{TENANT_BASE_DOMAIN}（optional、globally unique）
  3. custom domain: 任意のドメイン（optional、DNS 検証）

  例 (space: team-a):
    auto:          team-a-my-computer.app.example.com  → computer group
    auto:          team-a-my-docs.app.example.com      → docs group
    auto:          team-a-my-excel.app.example.com     → excel group
    auto:          team-a-my-slide.app.example.com     → slide group
    custom slug:   my-docs.app.example.com             → docs group (optional)
    custom domain: docs.mycompany.com                  → docs group (optional)
```

kernel と group はドメインが完全に分離される。

## 認証フロー

### ユーザー → Group

1. ユーザーが kernel の OAuth でログイン → session cookie が `.{TENANT_BASE_DOMAIN}` にセット
2. kernel と group が同じ parent domain (`.{TENANT_BASE_DOMAIN}`) を共有している場合、cookie は共有される
3. cookie が共有されない構成（custom domain 等）では、各 group は kernel の auth endpoint を使って認証を検証する（app token / JWT）

### Group 間 (サーバー)

group が他 group のサーバー API を呼ぶ場合は app token を使用する。

1. group が manifest で `scopes` を宣言する
2. kernel が deploy 時に JWT (RS256) を発行し、env `TAKOS_APP_TOKEN` として inject する
3. 呼び出し元 group は `Authorization: Bearer $TAKOS_APP_TOKEN` を付けてリクエストする
4. 受信側 group は kernel の JWKS (`/auth/.well-known/jwks.json`) で stateless に検証する
5. token の `scope` claim で呼び出し元のアクセス範囲を制御する

詳細は [kernel - App token](/architecture/kernel#app-token) を参照。
