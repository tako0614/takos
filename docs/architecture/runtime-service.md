# takos-runtime-service

`takos-runtime-service` は **Deno で動作する独立 HTTP サーバー** で、kernel
(`takos-control`) とは別 worker として deploy される。

主な責務:

- Sandboxed shell / tool execution
- Browser session bootstrap (Playwright)
- Workspace file 操作 (read / write / snapshot)
- GitHub Actions 互換 workflow job 実行
- Git smart-http endpoint (per-space scope)
- CLI proxy (loopback bypass)

ソース: `packages/runtime-service/`、entry point: `apps/runtime/src/index.ts`。
Deno container として `apps/runtime/Dockerfile` でビルドし、Cloudflare
Container DO (`takos-runtime-host` worker、`apps/control/wrangler.runtime-host.toml`)
にマウントする。

## 認証

すべての API は `Authorization: Bearer <jwt>` を要求し、`JWT_PUBLIC_KEY`
で RS256 検証する (kernel が `JWT_PRIVATE_KEY` で署名)。token claims:

| claim | 用途 |
| --- | --- |
| `sub` | calling user id |
| `scope_space_id` | scope を space に固定 |
| `session_id` | 関連 session (optional) |
| `exp` | 有効期限 |

::: warning JWT_PUBLIC_KEY
`apps/runtime/.env.example` では required と書かれているが、code は
`undefined` を許容する。empty key の状態で起動すると **first request 時に
503 (`Service token not configured`) で fail** する。fail-fast にしたい
場合は `requireEnv('JWT_PUBLIC_KEY')` で起動 guard をかけること。
:::

CLI proxy のみ **loopback bypass** が許可される。`X-Forwarded-For` /
`X-Real-IP` が `127.0.0.1` / `::1` で、かつ path が次の allowlist にある
場合のみ token 不要:

- `/cli-proxy/repos/:id/import`
- `/cli-proxy/repos/:id/export`
- `/cli-proxy/repos/:id/status`
- `/cli-proxy/repos/:id/log`
- `/cli-proxy/repos/:id/commit`

bypass 時は session 検索が `sessionStore` で行われ、workspace-scope は
チェックされない。**ingress 側で `X-Forwarded-For` を spoof 防止する必要が
ある** (CF Container はこれを正しく扱う)。

## エンドポイント

| group | path | description |
| --- | --- | --- |
| exec | `POST /exec` | sandboxed shell execution (max 60s) |
| exec | `POST /execute-tool` | named tool invocation |
| sessions | `POST /session/create` | new sandbox session |
| sessions | `POST /session/exec` | per-session command exec |
| sessions | `POST /session/snapshot/create` | session filesystem snapshot |
| sessions | `GET /session/:id/files/*` | session file read |
| sessions | `PUT /session/:id/files/*` | session file write |
| sessions | `DELETE /session/:id` | session destroy |
| repos | `POST /repos/:id/import` | repo import |
| repos | `POST /repos/:id/export` | repo export |
| repos | `GET /repos/:id/status` | git status |
| repos | `GET /repos/:id/log` | git log |
| repos | `POST /repos/:id/commit` | git commit |
| repos | `GET /repos/:id/branches/*` | branch ops |
| repos | `GET /repos/:id/content/*` | file read |
| repos | `PUT /repos/:id/content/*` | file write |
| git | `GET/POST /git/:spaceId/:repoName.git/*` | smart-http (Git protocol v2) |
| actions | `POST /actions/jobs` | workflow job create |
| actions | `POST /actions/jobs/:id/checkout` | repo checkout into job workspace |
| actions | `POST /actions/jobs/:id/step/:n` | run a workflow step |
| actions | `GET /actions/jobs/:id` | job status |
| actions | `POST /actions/jobs/:id/finish` | job finalize |
| cli-proxy | `POST /cli-proxy/repos/:id/*` | loopback CLI bypass |

::: tip Git path semantics
`git/:spaceId/:repoName.git/*` の **第 1 segment は spaceId** であり、
user-slug ではない (workspace-scope middleware が token の `scope_space_id`
と照合する)。`docs/reference/api.md` の git 経路は kernel-side のもので、
runtime-service は内部 git endpoint として使われる。
:::

## レート制限

| カテゴリ | path | 上限 |
| --- | --- | --- |
| `exec` | `/exec/*`, `/execute-tool`, `/session/exec` | 60 req/min |
| `session` | `/session/*`, `/sessions/*` | 30 req/min |
| `snapshot` | `/session/snapshot/*` | 10 req/min |
| `actions` | `/actions/*` | 60 req/min |
| `git` | `/git/*` | 120 req/min |
| `repos` | `/repos/*` | 60 req/min |
| `cli-proxy` | `/cli-proxy/*` | 60 req/min |

key は `${ip}:${spaceId}` (header `X-Takos-Space-Id` から)。429 response は
common error envelope の `{ error: { code: 'RATE_LIMITED', message, details: { retryAfter } } }`
shape を返し、`Retry-After` header も付与する。

## サンドボックス

`packages/runtime-service/src/utils/sandbox-env.ts` が **env var allowlist**
を enforce する:

- 許可: `CORE_SAFE_ENV` (PATH/HOME/LANG 等), `GIT_ENV`, `CI_ENV`,
  `TAKOS_ACTIONS_ENV_ALLOWLIST` で追加した explicit prefix
- 拒否: `BLOCKED_ENV` の一覧, `SENSITIVE_PATTERNS` (`AWS_*`, `JWT_*`,
  `TAKOS_*` 等) にマッチするもの

`packages/runtime-service/src/shared/config.ts` の **command allowlist /
blocklist** が dangerous シェル commands を block する (`rm -rf /`,
`reboot`, fork bomb, metadata service SSRF パターン等)。`COMMAND_PROFILE=extended`
で追加コマンドを opt-in できる。

## 制限値

| 設定 | 値 | 上書き |
| --- | --- | --- |
| `MAX_EXECUTION_TIME` | 60 s | env |
| `MAX_OUTPUT_SIZE` | 100 MB | env |
| `MAX_JOB_DURATION` | 60 min | env |
| `MAX_SESSION_FILE_READ_BYTES` | 5 MB | code constant (env override 未配線) |

::: warning MAX_SESSION_FILE_READ_BYTES
`apps/runtime/.env.example` では `50MB` と書かれているが、実 code constant は
**5 MB** で、env override は配線されていない。`.env.example` の値を信じない
こと。実際の値を変えるには `packages/runtime-service/src/shared/config.ts:58`
を編集する必要がある。
:::

## エラー envelope

すべての endpoint は kernel と同じ common error envelope を返す:

```json
{ "error": { "code": "BAD_REQUEST", "message": "..." } }
```

ただし古い `/actions/jobs/*` の handler では一部 flat な `{ error: "..." }`
shape を返していた。Round 11 Wave 2A で修正済み。

## デプロイ

`takos-runtime-service` は CF worker ではなく **CF Container DO** として
動く。env vars は wrangler 経由ではなく Docker secret + `apps/runtime/.env`
で供給する (`apps/runtime/Dockerfile` 参照)。host worker
(`takos-runtime-host`) は `apps/control/wrangler.runtime-host.toml` で
deploy する。

## 関連ドキュメント

- [Control plane](/architecture/control-plane) — 親の worker / container DO 構造
- [Threads and Runs](/platform/threads-and-runs) — sandbox session lifecycle
- [Workflows](/reference/api#repos-actions) — GitHub Actions 互換 workflow API
