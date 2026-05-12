# API リファレンス

> このページでわかること: Takos の HTTP API エンドポイント一覧。

## Auth

Takos は Takosumi Accounts の OIDC issuer を consumer として使います。

| method | path | description |
| --- | --- | --- |
| GET | `/auth/oidc/login` | Takosumi Accounts OIDC login |
| GET | `/auth/oidc/callback` | OIDC authorization code callback |
| POST | `/auth/logout` | app-local browser session logout |
| GET | `/api/auth/me` | 認証中ユーザー情報 |
| PATCH | `/api/auth/profile` | プロファイル更新 |
| POST | `/api/auth/logout` | API session logout |

## Me / Spaces

| method | path | description |
| --- | --- | --- |
| GET | `/api/me` | current user / account summary |
| GET | `/api/spaces` | space 一覧 |
| POST | `/api/spaces` | space 作成 |
| GET | `/api/spaces/:spaceId` | space 詳細 |
| PATCH | `/api/spaces/:spaceId` | space metadata 更新 |

## Threads / Runs / Tasks

| method | path | description |
| --- | --- | --- |
| GET | `/api/spaces/:spaceId/threads` | thread 一覧 |
| POST | `/api/spaces/:spaceId/threads` | thread 作成 |
| GET | `/api/threads/:threadId` | thread 詳細 |
| POST | `/api/threads/:threadId/runs` | agent run 作成 |
| GET | `/api/runs/:runId` | run 詳細 |
| GET | `/api/runs/:runId/sse` | run event stream |
| GET | `/api/spaces/:spaceId/agent-tasks` | agent task 一覧 |
| POST | `/api/spaces/:spaceId/agent-tasks` | agent task 作成 |
| GET | `/api/agent-tasks/:taskId` | agent task 詳細 |
| PATCH | `/api/agent-tasks/:taskId` | agent task 更新 |

## Repositories

Takos Git repository read / PR flow は `/api/repositories` family を使います。

| method | path | description |
| --- | --- | --- |
| GET | `/api/repositories?spaceId=...` | repository 一覧 |
| GET | `/api/repositories/:repoId` | repository metadata |
| POST | `/api/source/resolve` | source ref を commit に解決 |
| GET | `/api/repositories/:repoId/refs` | refs 一覧 |
| GET | `/api/repositories/:repoId/branches` | branch 一覧 |
| GET | `/api/repositories/:repoId/tags` | tag 一覧 |
| GET | `/api/repositories/:repoId/commits?ref=<ref>` | commit 一覧 |
| GET | `/api/repositories/:repoId/tree?ref=<ref>&path=<path>` | tree 取得 |
| GET | `/api/repositories/:repoId/blob?ref=<ref>&path=<path>` | blob 取得 |
| GET | `/api/repositories/:repoId/compare?base=<ref>&head=<ref>` | compare |

### Pull requests

| method | path | description |
| --- | --- | --- |
| GET | `/api/repositories/:repoId/pull-requests` | PR 一覧 |
| POST | `/api/repositories/:repoId/pull-requests` | PR 作成 |
| GET | `/api/repositories/:repoId/pull-requests/:prNumber` | PR 詳細 |
| PATCH | `/api/repositories/:repoId/pull-requests/:prNumber` | PR 更新 |
| GET | `/api/repositories/:repoId/pull-requests/:prNumber/diff` | PR diff |
| GET | `/api/repositories/:repoId/pull-requests/:prNumber/comments` | コメント一覧 |
| POST | `/api/repositories/:repoId/pull-requests/:prNumber/comments` | コメント追加 |
| GET | `/api/repositories/:repoId/pull-requests/:prNumber/reviews` | レビュー一覧 |
| POST | `/api/repositories/:repoId/pull-requests/:prNumber/reviews` | レビュー投稿 |
| POST | `/api/repositories/:repoId/pull-requests/:prNumber/ai-review` | AI review 実行 |
| POST | `/api/repositories/:repoId/pull-requests/:prNumber/merge` | fast-forward merge |

## Resources

| method | path | description |
| --- | --- | --- |
| GET | `/api/resources` | resource 一覧 |
| POST | `/api/resources` | resource 作成 |
| GET | `/api/resources/:resourceId` | resource 詳細 |
| PATCH | `/api/resources/:resourceId` | resource 更新 |
| DELETE | `/api/resources/:resourceId` | resource 削除 |
| POST | `/api/resources/:resourceId/sql/query` | SQL query 実行 |
| GET | `/api/resources/:resourceId/objects` | object 一覧 |
| PUT | `/api/resources/:resourceId/objects/:key` | object 保存 |
| GET | `/api/resources/:resourceId/objects/:key` | object 取得 |
| DELETE | `/api/resources/:resourceId/objects/:key` | object 削除 |

## Apps

Takos の app install lifecycle は operator account plane の AppInstallation API が所有します
(reference impl: Takosumi Accounts)。
Takos product は installed app の表示、launch、app-local session を扱います。

| method | path | description |
| --- | --- | --- |
| GET | `/api/spaces/:spaceId/apps` | installed app 一覧 |
| GET | `/api/apps/:appId` | installed app 詳細 |
| POST | `/_takosumi/launch` | launch token consume 後の app-local session 作成 |

AppInstallation API の詳細は
[Install API](https://github.com/tako0614/takosumi-cloud/blob/master/docs/accounts-service.md)
を参照してください。

## Notifications

| method | path | description |
| --- | --- | --- |
| GET | `/api/notifications` | 通知一覧 |
| GET | `/api/notifications/unread-count` | 未読件数 |
| PATCH | `/api/notifications/:id/read` | 既読にする |
| GET | `/api/notifications/preferences` | 通知設定取得 |
| PATCH | `/api/notifications/preferences` | 通知設定更新 |
| GET | `/api/notifications/sse` | SSE stream |
| GET | `/api/notifications/ws` | WebSocket stream |

## Smart HTTP

Git Smart HTTP protocol は Takos Git hosting が処理します。

| method | path | description |
| --- | --- | --- |
| GET | `/git/:owner/:repo.git/info/refs` | Git reference advertisement |
| POST | `/git/:owner/:repo.git/git-upload-pack` | Git fetch / clone |
| POST | `/git/:owner/:repo.git/git-receive-pack` | Git push |

## Examples

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

- [CLI command reference](/reference/cli)
- [OIDC Consumer](/apps/oidc-consumer)
- [Apps](/apps/)
