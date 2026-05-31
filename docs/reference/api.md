# API リファレンス

> このページでわかること: Takos product gateway と Takos Git Smart HTTP の
> current HTTP API route surface。

## Current Boundary

Takos は Takosumi Accounts の OIDC issuer を consumer として使い、app install /
uninstall / update の lifecycle は operator account plane (リファレンス実装:
Takosumi Accounts) の Accounts lifecycle API が所有します。Takos product gateway
は chat / agent / memory / space 操作、repository-backed deployment
request、installed app launch、product-owned resource / session control、Takos
Git への public route を扱います。

Takosumi の canonical install / deploy entry point は Takosumi Installation API
(= Takosumi installer API) の 5 endpoint
(`POST /v1/installations/dry-run`、`POST /v1/installations`、
`POST /v1/installations/{id}/deployments/dry-run`、
`POST /v1/installations/{id}/deployments`、`POST /v1/installations/{id}/rollback`)
です。Takos の `/api/public/v1/deployments` は repository-backed deployment
request を account-plane workflow に渡す product gateway であり、Takosumi
installer API の mirror ではありません。

Takos は OAuth provider、billing provider、publication、group deployment
snapshot の API owner ではありません。これらは current Takos API として expose
しません。

## 認証 (Auth)

| method | path                  | 説明                                                |
| ------ | --------------------- | --------------------------------------------------- |
| GET    | `/auth/oidc/login`    | Takosumi Accounts OIDC ログイン                     |
| GET    | `/auth/oidc/callback` | OIDC 認可コードのコールバック                       |
| POST   | `/auth/logout`        | ブラウザセッションのログアウト                      |
| GET    | `/api/auth/me`        | 認証中ユーザー情報                                  |
| PATCH  | `/api/auth/profile`   | プロファイル更新                                    |
| POST   | `/api/auth/logout`    | API セッションのログアウト                          |
| GET    | `/api/me`             | 現在のユーザー / アカウント情報                     |
| GET    | `/api/me/*`           | account-scoped settings / privacy などの user route |
| GET    | `/api/users`          | user profile 一覧                                   |
| GET    | `/api/users/*`        | user profile 詳細 / user-scoped route               |

## Spaces

| method | path          | 説明       |
| ------ | ------------- | ---------- |
| GET    | `/api/spaces` | space 一覧 |
| POST   | `/api/spaces` | space 作成 |

この表にない nested route は public API ではありません。新規 route
を増やす場合は owning service の contract と src/routes/public gateway
の責務を先に決め、unknown route は control backend に proxy せず 404
を返します。

## Threads / Runs / Artifacts

Thread / run の主要 route は `src/routes/public` が所有し、space membership
を確認して処理します。

### Threads

| method | path                                            | 説明                          |
| ------ | ----------------------------------------------- | ----------------------------- |
| GET    | `/api/spaces/:spaceId/threads`                  | space の thread 一覧          |
| GET    | `/api/spaces/:spaceId/threads/search`           | space 内 thread 検索          |
| POST   | `/api/spaces/:spaceId/threads`                  | thread 作成                   |
| GET    | `/api/threads/:threadId`                        | thread 詳細                   |
| PATCH  | `/api/threads/:threadId`                        | thread metadata / status 更新 |
| DELETE | `/api/threads/:threadId`                        | thread 削除                   |
| POST   | `/api/threads/:threadId/archive`                | thread を archive             |
| POST   | `/api/threads/:threadId/unarchive`              | thread を active に戻す       |
| GET    | `/api/threads/:threadId/runs`                   | thread の run 一覧            |
| POST   | `/api/threads/:threadId/runs`                   | agent run 作成                |
| GET    | `/api/threads/:threadId/history`                | thread history 取得           |
| GET    | `/api/threads/:threadId/export`                 | thread export                 |
| GET    | `/api/threads/:threadId/messages`               | message 一覧                  |
| POST   | `/api/threads/:threadId/messages`               | message 作成                  |
| GET    | `/api/threads/:threadId/messages/search`        | message 検索                  |
| GET    | `/api/threads/:threadId/shares`                 | share 一覧                    |
| POST   | `/api/threads/:threadId/share`                  | share 作成                    |
| POST   | `/api/threads/:threadId/shares/:shareId/revoke` | share revoke                  |

### Runs / Artifacts

| method | path                      | 説明                           |
| ------ | ------------------------- | ------------------------------ |
| GET    | `/api/runs/:id`           | run 詳細                       |
| GET    | `/api/runs/:id/events`    | run event polling              |
| GET    | `/api/runs/:id/replay`    | cursor 以降の run event replay |
| GET    | `/api/runs/:id/sse`       | run event SSE                  |
| GET    | `/api/runs/:id/ws`        | run event WebSocket            |
| POST   | `/api/runs/:id/cancel`    | run cancel                     |
| GET    | `/api/runs/:id/artifacts` | run artifact 一覧              |
| POST   | `/api/runs/:id/artifacts` | run artifact 作成              |
| GET    | `/api/artifacts/:id`      | artifact 詳細                  |

## Space Tools

Space tool の public API は下表の read route だけです。write / nested operation
を公開する場合は owning service の contract を先に定義し、この表に named route
として追加します。

| method | path                                   | 説明                |
| ------ | -------------------------------------- | ------------------- |
| GET    | `/api/spaces/:spaceId/tools`           | custom tool catalog |
| GET    | `/api/spaces/:spaceId/tools/:toolName` | custom tool 詳細    |

## Explore / Catalog

Explore / catalog route は `src/routes/public` が所有します。unknown `/api/explore/*` は
control backend に proxy せず 404 を返します。

| method | path                                                 | 説明                          |
| ------ | ---------------------------------------------------- | ----------------------------- |
| GET    | `/api/explore/suggest`                               | explore suggestion            |
| GET    | `/api/explore/catalog/suggest`                       | catalog suggestion            |
| GET    | `/api/explore/catalog`                               | catalog 一覧                  |
| GET    | `/api/explore/users`                                 | user 一覧                     |
| GET    | `/api/explore/users/:username`                       | user 詳細                     |
| GET    | `/api/explore/repos`                                 | repository 一覧               |
| GET    | `/api/explore/repos/trending`                        | trending repository           |
| GET    | `/api/explore/repos/new`                             | new repository                |
| GET    | `/api/explore/repos/recent`                          | recent repository             |
| GET    | `/api/explore/repos/by-name/:username/:repoName`     | owner/name で repository 取得 |
| GET    | `/api/explore/repos/:id`                             | repository 詳細               |
| GET    | `/api/explore/packages`                              | package 一覧                  |
| GET    | `/api/explore/packages/suggest`                      | package suggestion            |
| GET    | `/api/explore/packages/:username/:repoName/latest`   | latest package                |
| GET    | `/api/explore/packages/:username/:repoName/versions` | package versions              |
| GET    | `/api/explore/packages/by-repo/:repoId/reviews`      | package review 一覧           |

## Deployment Request Bridge

Takos product gateway は Installation-owned lifecycle
に接続するため、repository-backed deployment request を account-plane workflow
に渡します。request body は `appSpec` に `.takosumi.yml` AppSpec
(`apiVersion: v1`) を載せます。AppSpec root は `apiVersion` / `metadata` /
`components` です。canonical apply は Takosumi Installer API が所有します。

| method | path                         | 説明                    |
| ------ | ---------------------------- | ----------------------- |
| POST   | `/api/public/v1/deployments` | deployment request 作成 |

## リポジトリ

Takos Git リポジトリの読み取りや PR フローは `/api/repositories` を使います。

| method | path                                                      | 説明                        |
| ------ | --------------------------------------------------------- | --------------------------- |
| GET    | `/api/repositories?spaceId=...`                           | リポジトリ一覧              |
| GET    | `/api/repositories/:repoId`                               | リポジトリのメタデータ      |
| POST   | `/api/source/resolve`                                     | ソース ref を commit に解決 |
| GET    | `/api/repositories/:repoId/refs`                          | refs 一覧                   |
| GET    | `/api/repositories/:repoId/branches`                      | branch 一覧                 |
| GET    | `/api/repositories/:repoId/tags`                          | tag 一覧                    |
| GET    | `/api/repositories/:repoId/commits?ref=<ref>`             | commit 一覧                 |
| GET    | `/api/repositories/:repoId/commits/:commitSha`            | commit 詳細                 |
| GET    | `/api/repositories/:repoId/tree?ref=<ref>&path=<path>`    | tree 取得                   |
| GET    | `/api/repositories/:repoId/blob?ref=<ref>&path=<path>`    | blob 取得                   |
| GET    | `/api/repositories/:repoId/compare?base=<ref>&head=<ref>` | 比較                        |

### Pull request

| method | path                                                        | 説明                |
| ------ | ----------------------------------------------------------- | ------------------- |
| GET    | `/api/repositories/:repoId/pull-requests`                   | PR 一覧             |
| POST   | `/api/repositories/:repoId/pull-requests`                   | PR 作成             |
| GET    | `/api/repositories/:repoId/pull-requests/:number`           | PR 詳細             |
| PATCH  | `/api/repositories/:repoId/pull-requests/:number`           | PR 更新             |
| GET    | `/api/repositories/:repoId/pull-requests/:number/diff`      | PR の diff          |
| GET    | `/api/repositories/:repoId/pull-requests/:number/comments`  | コメント一覧        |
| POST   | `/api/repositories/:repoId/pull-requests/:number/comments`  | コメント追加        |
| GET    | `/api/repositories/:repoId/pull-requests/:number/reviews`   | レビュー一覧        |
| POST   | `/api/repositories/:repoId/pull-requests/:number/reviews`   | レビュー投稿        |
| POST   | `/api/repositories/:repoId/pull-requests/:number/ai-review` | AI レビュー実行     |
| POST   | `/api/repositories/:repoId/pull-requests/:number/merge`     | fast-forward マージ |

## Product Resource / Session Control

この section の route は Takos product が所有する service / resource / session
control API です。installed app の public HTTP ingress ではありません。installed
app の public request は provider-native ingress から active workload へ届き、
Takos product gateway や Takosumi kernel process を per-request proxy
として経由しません。

| method | path                               | 説明                                   |
| ------ | ---------------------------------- | -------------------------------------- |
| GET    | `/api/services`                    | service 一覧                           |
| POST   | `/api/services`                    | service 作成                           |
| *      | `/api/services/*`                  | service nested operation               |
| GET    | `/api/resources`                   | resource 一覧                          |
| POST   | `/api/resources`                   | resource 作成                          |
| *      | `/api/resources/*`                 | resource nested operation              |
| GET    | `/api/sessions`                    | session 一覧                           |
| POST   | `/api/sessions`                    | session 作成                           |
| *      | `/api/sessions/*`                  | session nested operation               |
| GET    | `/api/spaces/:spaceId/services`    | space-scoped service 一覧              |
| *      | `/api/spaces/:spaceId/services/*`  | space-scoped service nested operation  |
| GET    | `/api/spaces/:spaceId/resources`   | space-scoped resource 一覧             |
| POST   | `/api/spaces/:spaceId/resources`   | space-scoped resource 作成             |
| *      | `/api/spaces/:spaceId/resources/*` | space-scoped resource nested operation |
| GET    | `/api/spaces/:spaceId/sessions`    | space-scoped session 一覧              |
| POST   | `/api/spaces/:spaceId/sessions`    | space-scoped session 作成              |
| *      | `/api/spaces/:spaceId/sessions/*`  | space-scoped session nested operation  |

## アプリ

Takos のアプリインストールの lifecycle は、operator account plane の Accounts
lifecycle API (リファレンス実装: Takosumi Accounts) が所有します。Takos product
はインストール済みアプリの表示、起動、 app-local セッションを扱います。

| method | path                                                              | 説明                                           |
| ------ | ----------------------------------------------------------------- | ---------------------------------------------- |
| GET    | `/api/apps`                                                       | app catalog / app detail                       |
| GET    | `/api/apps/*`                                                     | named app route                                |
| GET    | `/api/spaces/:spaceId/app-installations`                          | Installation ledger 一覧                       |
| POST   | `/api/spaces/:spaceId/app-installations/apply`                    | bundled app install apply                      |
| POST   | `/api/spaces/:spaceId/app-installations/git-url/dry-run`          | Git URL app install dry-run bridge             |
| POST   | `/api/spaces/:spaceId/app-installations/git-url/apply`            | Git URL app install apply                      |
| POST   | `/api/spaces/:spaceId/app-installations/git-url/revision/dry-run` | Git URL app Deployment dry-run bridge          |
| POST   | `/api/spaces/:spaceId/app-installations/git-url/revision/apply`   | Git URL app revision apply                     |
| DELETE | `/api/spaces/:spaceId/app-installations/:installationId`          | Installation 削除                              |
| GET    | `/_takosumi/launch`                                               | launch token 消費後の app-local セッション作成 |
| POST   | `/_takosumi/launch`                                               | launch token 消費後の app-local セッション作成 |

Installation account-plane API の詳細は
[Takosumi Accounts lifecycle API](https://github.com/tako0614/takosumi-cloud/blob/main/docs/accounts-service.md)
を参照してください。

## 通知

| method | path                              | 説明                 |
| ------ | --------------------------------- | -------------------- |
| GET    | `/api/notifications`              | 通知一覧             |
| GET    | `/api/notifications/unread-count` | 未読件数             |
| PATCH  | `/api/notifications/:id/read`     | 既読にする           |
| GET    | `/api/notifications/preferences`  | 通知設定取得         |
| PATCH  | `/api/notifications/preferences`  | 通知設定更新         |
| GET    | `/api/notifications/sse`          | SSE ストリーム       |
| GET    | `/api/notifications/ws`           | WebSocket ストリーム |

## Smart HTTP

Git Smart HTTP プロトコルは Takos Git hosting が処理します。

| method | path                                     | 説明                  |
| ------ | ---------------------------------------- | --------------------- |
| GET    | `/git/:owner/:repo.git/info/refs`        | Git の reference 広告 |
| POST   | `/git/:owner/:repo.git/git-upload-pack`  | Git fetch / clone     |
| POST   | `/git/:owner/:repo.git/git-receive-pack` | Git push              |

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
  https://your-takos.example/api/runs/run_123/sse
```

## 次に読むページ

- [OIDC Consumer](/apps/oidc-consumer)
- [アプリ](/apps/)
