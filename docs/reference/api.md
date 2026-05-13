# API リファレンス

> このページでわかること: Takos の HTTP API エンドポイント一覧。

## 認証 (Auth)

Takos は Takosumi Accounts の OIDC issuer を consumer として使います。

| method | path | 説明 |
| --- | --- | --- |
| GET | `/auth/oidc/login` | Takosumi Accounts OIDC ログイン |
| GET | `/auth/oidc/callback` | OIDC 認可コードのコールバック |
| POST | `/auth/logout` | ブラウザセッションのログアウト |
| GET | `/api/auth/me` | 認証中ユーザー情報 |
| PATCH | `/api/auth/profile` | プロファイル更新 |
| POST | `/api/auth/logout` | API セッションのログアウト |

## Me / Spaces

| method | path | 説明 |
| --- | --- | --- |
| GET | `/api/me` | 現在のユーザー / アカウント情報 |
| GET | `/api/spaces` | space 一覧 |
| POST | `/api/spaces` | space 作成 |
| GET | `/api/spaces/:spaceId` | space 詳細 |
| PATCH | `/api/spaces/:spaceId` | space メタデータ更新 |

## Threads / Runs / Tasks

| method | path | 説明 |
| --- | --- | --- |
| GET | `/api/spaces/:spaceId/threads` | thread 一覧 |
| POST | `/api/spaces/:spaceId/threads` | thread 作成 |
| GET | `/api/threads/:threadId` | thread 詳細 |
| POST | `/api/threads/:threadId/runs` | agent run 作成 |
| GET | `/api/runs/:runId` | run 詳細 |
| GET | `/api/runs/:runId/sse` | run のイベントストリーム |
| GET | `/api/spaces/:spaceId/agent-tasks` | agent task 一覧 |
| POST | `/api/spaces/:spaceId/agent-tasks` | agent task 作成 |
| GET | `/api/agent-tasks/:taskId` | agent task 詳細 |
| PATCH | `/api/agent-tasks/:taskId` | agent task 更新 |

## リポジトリ

Takos Git リポジトリの読み取りや PR フローは `/api/repositories` を使います。

| method | path | 説明 |
| --- | --- | --- |
| GET | `/api/repositories?spaceId=...` | リポジトリ一覧 |
| GET | `/api/repositories/:repoId` | リポジトリのメタデータ |
| POST | `/api/source/resolve` | ソース ref を commit に解決 |
| GET | `/api/repositories/:repoId/refs` | refs 一覧 |
| GET | `/api/repositories/:repoId/branches` | branch 一覧 |
| GET | `/api/repositories/:repoId/tags` | tag 一覧 |
| GET | `/api/repositories/:repoId/commits?ref=<ref>` | commit 一覧 |
| GET | `/api/repositories/:repoId/tree?ref=<ref>&path=<path>` | tree 取得 |
| GET | `/api/repositories/:repoId/blob?ref=<ref>&path=<path>` | blob 取得 |
| GET | `/api/repositories/:repoId/compare?base=<ref>&head=<ref>` | 比較 |

### Pull request

| method | path | 説明 |
| --- | --- | --- |
| GET | `/api/repositories/:repoId/pull-requests` | PR 一覧 |
| POST | `/api/repositories/:repoId/pull-requests` | PR 作成 |
| GET | `/api/repositories/:repoId/pull-requests/:prNumber` | PR 詳細 |
| PATCH | `/api/repositories/:repoId/pull-requests/:prNumber` | PR 更新 |
| GET | `/api/repositories/:repoId/pull-requests/:prNumber/diff` | PR の diff |
| GET | `/api/repositories/:repoId/pull-requests/:prNumber/comments` | コメント一覧 |
| POST | `/api/repositories/:repoId/pull-requests/:prNumber/comments` | コメント追加 |
| GET | `/api/repositories/:repoId/pull-requests/:prNumber/reviews` | レビュー一覧 |
| POST | `/api/repositories/:repoId/pull-requests/:prNumber/reviews` | レビュー投稿 |
| POST | `/api/repositories/:repoId/pull-requests/:prNumber/ai-review` | AI レビュー実行 |
| POST | `/api/repositories/:repoId/pull-requests/:prNumber/merge` | fast-forward マージ |

## リソース

| method | path | 説明 |
| --- | --- | --- |
| GET | `/api/resources` | リソース一覧 |
| POST | `/api/resources` | リソース作成 |
| GET | `/api/resources/:resourceId` | リソース詳細 |
| PATCH | `/api/resources/:resourceId` | リソース更新 |
| DELETE | `/api/resources/:resourceId` | リソース削除 |
| POST | `/api/resources/:resourceId/sql/query` | SQL クエリ実行 |
| GET | `/api/resources/:resourceId/objects` | オブジェクト一覧 |
| PUT | `/api/resources/:resourceId/objects/:key` | オブジェクト保存 |
| GET | `/api/resources/:resourceId/objects/:key` | オブジェクト取得 |
| DELETE | `/api/resources/:resourceId/objects/:key` | オブジェクト削除 |

## アプリ

Takos のアプリインストールのライフサイクルは、operator アカウントプレーンの AppInstallation API
(リファレンス実装: Takosumi Accounts) が所有します。
Takos プロダクトはインストール済みアプリの表示、起動、app-local セッションを扱います。

| method | path | 説明 |
| --- | --- | --- |
| GET | `/api/spaces/:spaceId/apps` | インストール済みアプリ一覧 |
| GET | `/api/apps/:appId` | インストール済みアプリ詳細 |
| POST | `/_takosumi/launch` | launch token 消費後の app-local セッション作成 |

AppInstallation API の詳細は
[Install API](https://github.com/tako0614/takosumi-cloud/blob/master/docs/accounts-service.md)
を参照してください。

## 通知

| method | path | 説明 |
| --- | --- | --- |
| GET | `/api/notifications` | 通知一覧 |
| GET | `/api/notifications/unread-count` | 未読件数 |
| PATCH | `/api/notifications/:id/read` | 既読にする |
| GET | `/api/notifications/preferences` | 通知設定取得 |
| PATCH | `/api/notifications/preferences` | 通知設定更新 |
| GET | `/api/notifications/sse` | SSE ストリーム |
| GET | `/api/notifications/ws` | WebSocket ストリーム |

## Smart HTTP

Git Smart HTTP プロトコルは Takos Git hosting が処理します。

| method | path | 説明 |
| --- | --- | --- |
| GET | `/git/:owner/:repo.git/info/refs` | Git の reference 広告 |
| POST | `/git/:owner/:repo.git/git-upload-pack` | Git fetch / clone |
| POST | `/git/:owner/:repo.git/git-receive-pack` | Git push |

## サンプル

```bash
curl -H "Authorization: Bearer takpat_..." \
  https://your-takos.example/api/me
```

```bash
curl -X POST \
  -H "Authorization: Bearer takpat_..." \
  -H "Content-Type: application/json" \
  -d '{"title":"debug"}' \
  https://your-takos.example/api/spaces/ws_123/threads
```

```bash
curl -H "Authorization: Bearer takpat_..." \
  "https://your-takos.example/api/repositories/repo_123/blob?ref=main&path=src/index.ts"
```

```bash
curl -N \
  -H "Authorization: Bearer takpat_..." \
  https://your-takos.example/api/notifications/sse
```

## 次に読むページ

- [CLI コマンドリファレンス](/reference/cli)
- [OIDC Consumer](/apps/oidc-consumer)
- [アプリ](/apps/)
