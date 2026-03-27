# API リファレンス

<!-- docs:api-families seed-repositories,explore,profiles,public-share,mcp,setup,me,spaces,shortcuts,services,custom-domains,resources,apps,threads,runs,search,index,memories,skills,sessions,git,repos,agent-tasks,notifications,pull-requests,app-deployments,browser-sessions,billing,auth,oauth -->

::: tip Coverage
このページは **route family 単位の current contract** をまとめています。Takos の public API は `/api/*` 配下で提供され、CLI の task domain もこの family 群にマップされます。
:::

## このリファレンスで依存してよい範囲

- `/api/*` の family ごとの責務
- auth mode と representative path
- current API surface の読み分け

## このリファレンスで依存してはいけない範囲

- family 名だけを見て lower-level internal route まで current contract だと解釈すること
- architecture や実装コードにある補助 route を、このページの代わりに採用判断へ使うこと
- request / response の完全 wire schema がここに全部書かれていると期待すること

## API の読み方

Takos API は、1 endpoint ずつの一覧よりも family 単位の責務で読む方が迷いません。
まず family を決め、次に auth mode と representative path を見ます。

## 認証

| mode | 使い方 | 用途 |
| --- | --- | --- |
| Session cookie | browser から `Cookie` | SPA / console |
| PAT | `Authorization: Bearer tak_pat_...` | CLI / automation |
| OAuth bearer | `Authorization: Bearer tak_oat_...` | third-party apps |
| Internal binding | service binding + internal headers | worker 間通信 |

PAT は `/api/me/personal-access-tokens` で管理します。

## Route families

### Public / optional auth

| family | auth | representative paths | purpose |
| --- | --- | --- | --- |
| `seed-repositories` | none | `/api/seed-repositories` | 初回導入用 seed repo 一覧 |
| `explore` | optional | `/api/explore/repos`, `/api/explore/catalog`, `/api/explore/users` | 公開 catalog / discover |
| `profiles` | optional | `/api/users/:username`, `/api/users/:username/repos` | 公開 profile / repo view |
| `public-share` | mixed | `/api/public/thread-shares/:token` | thread share の read / access grant |
| `mcp` | mixed | `/api/mcp/oauth/callback`, `/api/mcp/servers` | MCP OAuth callback と MCP server 管理 |
| `billing` | mixed | `/api/billing/webhook` | Stripe webhook |
| `oauth` | session | `/api/oauth/authorize/context`, `/api/oauth/device/context` | consent UI 用 API |

### Authenticated families

| family | representative paths | purpose |
| --- | --- | --- |
| `setup` | `/api/setup/status`, `/api/setup/complete` | 初期セットアップ状態 |
| `me` | `/api/me`, `/api/me/settings`, `/api/me/oauth/*`, `/api/me/personal-access-tokens` | current user / settings / PAT / OAuth client |
| `spaces` | `/api/spaces`, `/api/spaces/:spaceId`, `/api/spaces/:spaceId/members` | workspace/space 基本 CRUD |
| `spaces.storage` | `/api/spaces/:spaceId/storage/*` | file upload/download/list/bulk ops/file handlers |
| `spaces.common-env` | `/api/spaces/:spaceId/common-env` | 共通 env の read/write/delete |
| `spaces.stores` | `/api/spaces/:spaceId/stores`, `/api/spaces/:spaceId/store-registry/*` | store / registry / install flows |
| `shortcuts` | `/api/shortcuts`, `/api/spaces/:spaceId/shortcuts/groups` | shortcut と group 管理 |
| `services` | `/api/services`, `/api/services/:id` | service CRUD と runtime 管理 |
| `custom-domains` | `/api/services/:id/custom-domains/*` | custom domain verify / SSL refresh |
| `resources` | `/api/resources`, `/api/resources/:id/*` | resource CRUD / access / tokens / D1 / R2 |
| `apps` | `/api/apps`, `/api/apps/:id`, `/api/apps/:id/client-key` | builtin/custom app listing |
| `threads` | `/api/spaces/:spaceId/threads`, `/api/threads/:id/messages`, `/api/threads/:id/share` | thread / message / share |
| `runs` | `/api/threads/:threadId/runs`, `/api/runs/:id`, `/api/runs/:id/sse`, `/api/runs/:id/ws` | run 実行・event stream・artifact |
| `search` | `/api/spaces/:spaceId/search`, `/api/spaces/:spaceId/search/quick` | semantic / quick search |
| `index` | `/api/spaces/:spaceId/index`, `/api/spaces/:spaceId/graph` | indexing / graph 系 |
| `memories` | `/api/spaces/:spaceId/memories`, `/api/spaces/:spaceId/reminders` | memory / reminder |
| `skills` | `/api/spaces/:spaceId/skills`, `/api/workspaces/:workspaceId/skills` | skill catalog / custom skill |
| `sessions` | `/api/sessions/:sessionId/*` | session health / resume / discard / heartbeat |
| `git` | `/api/spaces/:spaceId/git/*` | space-scoped git 操作 |
| `repos` | `/api/spaces/:spaceId/repos`, `/api/repos/:repoId/*` | repo CRUD / tree/blob/commits/branches/releases/actions |
| `pull-requests` | `/api/repos/:repoId/pulls/*` | PR / review 系 |
| `agent-tasks` | `/api/spaces/:spaceId/agent-tasks`, `/api/agent-tasks/:id/plan` | task orchestration |
| `notifications` | `/api/notifications`, `/api/notifications/sse`, `/api/notifications/ws` | notification list / SSE / WS |
| `app-deployments` | `/api/spaces/:spaceId/app-deployments`, `/rollback`, `/rollout/*` | app deploy / rollback / rollout control |
| `browser-sessions` | `/api/spaces/:spaceId/browser-sessions`, `/api/browser-sessions/:id/*` | browser session lifecycle |
| `billing` | `/api/billing`, `/api/billing/usage`, `/api/billing/subscribe`, `/api/billing/invoices/*` | current account billing |
| `auth` | `/api/auth/me`, `/api/auth/profile`, `/api/auth/logout` | authenticated auth/profile actions |

## Representative operation models

### `spaces`

`spaces` family は workspace/space を起点にした surface です。
基本 CRUD だけでなく、次の subresource を current contract に含みます。

- members
- repos bootstrap
- storage
- common env
- stores
- store registry

### `runs`

`runs` family は request/response だけでなく stream surface も持ちます。
状態変化を追うときは `/api/runs/:id/sse` または `/api/runs/:id/ws` を使います。

### `services`

`services` family は service/runtime surface の current public route family です。
codebase や UI に `worker` という語が残る場面がありますが、API path の正本は `/api/services` として読みます。

### `repos`

`repos` family は repo CRUD に加えて、tree/blob/history、releases、actions、pull requests への入口でもあります。
Takos CLI で `repo` domain が広い責務を持つのはこのためです。

### `app-deployments`

`app-deployments` family は repo-local app deploy の public/current API です。
主説明面は `services/:id/deployments` ではなく `/api/spaces/:spaceId/app-deployments` です。

主要 endpoint:

- `POST /api/spaces/:spaceId/app-deployments`
- `GET /api/spaces/:spaceId/app-deployments`
- `GET /api/spaces/:spaceId/app-deployments/:appDeploymentId`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollback`
- `GET /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/pause`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/resume`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/abort`
- `POST /api/spaces/:spaceId/app-deployments/:appDeploymentId/rollout/promote`

## implementation note

deploy family は current public surface ですが、today の implementation gap は [Deploy System](/specs/deploy-system) に従って読みます。
このリファレンスは route family の存在と役割を示すものであり、end-to-end availability の保証は implementation note を優先してください。

## Examples

### current user を取得

```bash
curl -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/me
```

### thread を作成

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"title":"debug"}' \
  https://your-takos.example/api/spaces/ws_123/threads
```

### app deploy を開始

```bash
curl -X POST \
  -H "Authorization: Bearer tak_pat_..." \
  -H "Content-Type: application/json" \
  -d '{"repo_id":"repo_123","ref":"main","ref_type":"branch"}' \
  https://your-takos.example/api/spaces/ws_123/app-deployments
```

### run event を SSE で追う

```bash
curl -N \
  -H "Authorization: Bearer tak_pat_..." \
  https://your-takos.example/api/runs/run_123/sse
```

## 次に読むページ

- [Deploy System](/specs/deploy-system)
- [CLI command reference](/reference/commands)
- [用語集](/reference/glossary)
