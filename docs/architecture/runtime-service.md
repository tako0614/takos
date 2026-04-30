# takos-runtime-service

`takos-runtime-service` は Deno で動作する独立 HTTP サーバーで、kernel
(`takos-control`) とは別の internal execution plane。control-plane の
process role の一つとして runtime host から呼び出される。Deployment lifecycle
を扱う Core process のうち、sandbox shell / workflow job / git smart-http
/ CLI proxy を担当する provider operation 側 execution plane に位置する
(observed 側は `Deployment.conditions[]` および ProviderObservation に落ちる)。

主な責務:

- Sandboxed shell / tool execution
- Sandbox file 操作 (read / write / snapshot)
- GitHub Actions 互換 workflow job 実行
- Git smart-http endpoint (per-space scope)
- CLI proxy (loopback bypass)

ソースは runtime-service package、entry point は runtime service の container
bootstrap。Deno container として
`ghcr.io/takos/runtime-service:latest` でビルドし、
backend-specific な runtime host worker からマウントされる。tracked reference
Workers backend での実装詳細は本ページ末尾の collapsible 節 (Workers backend
reference materialization) を参照。

これは user group の Worker / Service runtime とは別の internal execution
plane。

## 認証

`GET /health` と `GET /healthz` 以外の API は `Authorization: Bearer <jwt>`
を要求し、runtime-service container の `JWT_PUBLIC_KEY` で RS256 検証する。
`GET /ping` は control plane からの authenticated smoke probe であり、public
health check ではない。署名鍵の基準は `PLATFORM_PRIVATE_KEY` /
`PLATFORM_PUBLIC_KEY`:

- control-plane process (kernel main / background worker process role) は
  `PLATFORM_PRIVATE_KEY` で runtime-service JWT を署名する
- runtime host process role は `PLATFORM_PUBLIC_KEY` を container env の
  `JWT_PUBLIC_KEY` として渡す
- 互換用に `JWT_PUBLIC_KEY` を明示する場合も `PLATFORM_PUBLIC_KEY`
  と同じ公開鍵にする
- `JWT_PRIVATE_KEY` は使用しない

token claims:

| claim            | 用途                    |
| ---------------- | ----------------------- |
| `sub`            | calling user id         |
| `scope_space_id` | scope を space に固定   |
| `session_id`     | 関連 session (optional) |
| `exp`            | 有効期限                |

::: warning JWT_PUBLIC_KEY runtime host process 経由の container では host
process が `PLATFORM_PUBLIC_KEY` から注入する。runtime-service を直接起動する
local/self-host 構成では、`JWT_PUBLIC_KEY` に `PLATFORM_PUBLIC_KEY` と同じ
公開鍵を設定する。未設定や不一致の状態では service-token JWT を検証できない。
:::

### CLI-proxy loopback bypass

CLI-proxy のみ **conditional loopback bypass** が許可される。これは
`TAKOS_RUNTIME_ALLOW_LOOPBACK_CLI_PROXY_BYPASS=1` が設定されているか、または
runtime-service が local data dir / `allowLocalCliProxyBypass` option 付きで
起動されている場合にのみ有効になる。次の条件をすべて満たす request は
service-token JWT 不要で通る (`isLocalCliProxyBypassRequest`):

1. path が `/cli-proxy/*` prefix に一致する
2. `Authorization: Bearer` service token が存在しない
   (`getServiceTokenFromHeader` が null を返す)
3. `X-Takos-Session-Id` header が存在する (caller が持っている sandbox session
   id)
4. runtime-service が実接続元を loopback address (`127.0.0.1` / `::1` /
   `::ffff:127.0.0.1`) と判定できる

`X-Forwarded-For` / `X-Real-IP` は trust boundary ではありません。PaaS の
internal RPC は service identity / signed RPC を原則とし、この bypass は local
data dir 付き runtime-service の CLI proxy に限定した compatibility path です。

上記を通過した request は次の 5 件の allowlist 正規表現にある API path のみ
forward される (`ALLOWED_PATHS`)。request path の `/cli-proxy` prefix
を削除した残り (= target `apiPath`) に対してマッチする:

- `/api/repos/:id/import`
- `/api/repos/:id/export`
- `/api/repos/:id/status`
- `/api/repos/:id/log`
- `/api/repos/:id/commit`

一致しないものは 403 を返す。上記 5 件以外の API surface (例 `/api/threads/*`,
`/api/runs/*`) は loopback bypass では呼べない。

bypass 時は session 検索が `sessionStore.getSession(sessionId)` で行われ、
session が持つ `spaceId` と request header の `X-Takos-Space-Id` が一致
しない場合は 403。`/cli-proxy/*` path には space-scope middleware
(`enforceSpaceScopeMiddleware`) は掛かっていないが、上記の session vs space
check が実効的な space 分離として機能する。

::: warning Ingress spoof 防止が前提 loopback bypass は `X-Forwarded-For` /
`X-Real-IP` header を trust boundary として使わず、runtime-service に渡された
実接続元 address だけを見る。client が直接 control できる ingress ではなく、
trusted binding として接続元 address を渡せる runtime host process / direct
Deno serve のような実行環境が前提になる。spoof 防止が保証できない deployment
では、`TAKOS_RUNTIME_ALLOW_LOOPBACK_CLI_PROXY_BYPASS=1` を設定せず、local
data-dir / `allowLocalCliProxyBypass` option も有効化しない。この経路は public
API ではなく internal fast path なので、trusted ingress が維持できない環境では
使わない。tracked reference Workers backend の Container runtime は internal
loopback のみ `127.0.0.1` を立てるため、この仮定は production では成立する。

kernel 側の CLI traffic flow (PAT auth → runtime host process → container
loopback) については
[Control plane § CLI proxy loopback bypass](/architecture/control-plane#cli-proxy-loopback-bypass)
を参照。
:::

### CLI traffic flow

operator の workstation から runtime-service の CLI proxy に到達するまでの
request path。runtime-service は repo 操作を直接実行せず、session / allowlist
を確認したあと control API に戻す。

```text
CLI on operator workstation
  → HTTPS POST → kernel (PAT auth)
  → kernel forwards via internal binding to runtime host process
  → runtime host /forward/cli-proxy/...
  → runtime-service /cli-proxy/api/repos/:id/...    (loopback bypass enabled when configured)
  → runtime host /forward/cli-proxy/api/repos/:id/...
  → kernel /api/repos/:id/...
```

- CLI → kernel は通常の PAT 認証 (`Authorization: Bearer <pat>`)
- kernel → runtime host は backend-specific な internal binding
- runtime host は `/forward/cli-proxy/*` を runtime-service の `/cli-proxy/*`
  に中継する
- runtime-service 側は container 内の loopback (`127.0.0.1`) で到達する
- runtime-service は実接続元が loopback であることを確認し、path が CLI proxy
  allowlist にあれば bypass を許可する。proxy header は bypass
  判定の信頼根にしない
- runtime-service は session の proxy token で runtime host に戻し、runtime
  host が kernel の `/api/repos/:id/*` に中継する

## エンドポイント

| group     | exact routes                                                                                                                                                                                                                                                                  | description                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| health    | `GET /health`, `GET /healthz`                                                                                                                                                                                                                                                 | public liveness / health check                     |
| health    | `GET /ping`                                                                                                                                                                                                                                                                   | authenticated smoke probe                          |
| exec      | `POST /exec`, `POST /execute-tool`                                                                                                                                                                                                                                            | sandboxed shell execution / named tool execution   |
| exec      | `GET /status/:id`                                                                                                                                                                                                                                                             | process status lookup                              |
| sessions  | `POST /sessions`, `POST /sessions/:id/commit`                                                                                                                                                                                                                                 | sandbox session lifecycle                          |
| session   | `POST /session/exec`, `POST /session/init`, `POST /session/destroy`                                                                                                                                                                                                           | per-session command lifecycle                      |
| session   | `POST /session/file/read`, `POST /session/file/write`, `POST /session/file/write-binary`, `POST /session/file/delete`, `POST /session/file/list`                                                                                                                              | session file I/O                                   |
| session   | `POST /session/snapshot`                                                                                                                                                                                                                                                      | session filesystem snapshot                        |
| repos     | `POST /repos/init`, `POST /repos/clone`, `POST /repos/commit`, `POST /repos/push`, `POST /repos/merge`, `POST /repos/branch`, `DELETE /repos/branch`                                                                                                                          | repository operations                              |
| repos     | `GET /repos/:spaceId/:repoName/diff`, `GET /repos/:spaceId/:repoName/branches`, `GET /repos/:spaceId/:repoName/tree`, `GET /repos/:spaceId/:repoName/blob`, `GET /repos/:spaceId/:repoName/commits`                                                                           | repository read operations                         |
| repos     | `GET /repos/:repoId/export`, `GET /repos/:repoId/status`, `GET /repos/:repoId/log`, `GET /repos/:repoId/branches/*`, `GET /repos/:repoId/content/*`, `POST /repos/:repoId/import`, `POST /repos/:repoId/export`, `POST /repos/:repoId/commit`, `PUT /repos/:repoId/content/*` | repoId compatibility routes (control API への案内) |
| git       | `POST /git/init`, `GET /git/:spaceId/:repoName.git/*`, `POST /git/:spaceId/:repoName.git/*`                                                                                                                                                                                   | git repository bootstrap / smart-http              |
| git-lfs   | `POST /git/:spaceId/:repoName.git/info/lfs/objects/batch`, `PUT /git/:spaceId/:repoName.git/info/lfs/objects/:oid`, `GET /git/:spaceId/:repoName.git/info/lfs/objects/:oid`                                                                                                   | Git LFS batch/upload/download                      |
| actions   | `POST /actions/jobs/:jobId/start`, `POST /actions/jobs/:jobId/checkout`, `POST /actions/jobs/:jobId/step/:stepNumber`, `GET /actions/jobs/:jobId/status`, `GET /actions/jobs/:jobId/logs`, `POST /actions/jobs/:jobId/complete`, `DELETE /actions/jobs/:jobId`                | workflow job orchestration                         |
| cli-proxy | `GET /cli-proxy/*`, `POST /cli-proxy/*`                                                                                                                                                                                                                                       | loopback CLI bypass for allowlisted repo API paths |

### CLI proxy method matrix

`/cli-proxy/*` では次の path / method のみ forward される。

| method | path pattern            |
| ------ | ----------------------- |
| `POST` | `/api/repos/:id/import` |
| `GET`  | `/api/repos/:id/export` |
| `GET`  | `/api/repos/:id/status` |
| `GET`  | `/api/repos/:id/log`    |
| `POST` | `/api/repos/:id/commit` |

::: tip Git path semantics `/git/:spaceId/:repoName.git/*` の **第 1 segment は
spaceId** であり、UUID 形式の space 主キーである。`user-slug` / `space-slug` /
human-readable identifier ではない点に注意。request の `Authorization: Bearer`
JWT に含まれる `scope_space_id` claim と path の spaceId が照合される
(`middleware/space-scope.ts
enforceSpaceScopeMiddleware`)。不一致は 403。

kernel 側の public git API (`docs/reference/api.md` の `git` family、
`GET /api/git/:owner/:repoName/...` や smart-http endpoint
`GET/POST /git/:owner/:repoName.git/*`) は **別系統**:

- 第 1 segment が `:owner` (= user-facing owner slug / space slug)
- user session or PAT で認証
- kernel 内部で DB lookup → spaceId に解決し、実 git storage へ

runtime-service の `/git/:spaceId/:repoName.git/*` は runtime container 内
から呼ばれる内部 endpoint で、すでに spaceId を直接受け取っている前提の fast
path。外部 caller は kernel 側 endpoint を使うこと。
:::

## レート制限

| category    | exact routes                                                                                                                                                                                                                                                                          | limit      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `exec`      | `POST /exec`, `POST /execute-tool`, `POST /session/exec`                                                                                                                                                                                                                              | 60 req/min |
| `session`   | `POST /session/init`, `POST /session/destroy`, `POST /session/file/read`, `POST /session/file/write`, `POST /session/file/write-binary`, `POST /session/file/delete`, `POST /session/file/list`, `POST /sessions`, `POST /sessions/:id/commit`, `POST /session/*`, `POST /sessions/*` | 30 req/min |
| `snapshot`  | `POST /session/snapshot`                                                                                                                                                                                                                                                              | 10 req/min |
| `actions`   | `/actions/*`                                                                                                                                                                                                                                                                          | 30 req/min |
| `git`       | `POST /git/init`, `GET /git/:spaceId/:repoName.git/*`, `POST /git/:spaceId/:repoName.git/*`                                                                                                                                                                                           | 30 req/min |
| `repos`     | `/repos/*`                                                                                                                                                                                                                                                                            | 60 req/min |
| `cli-proxy` | `GET /cli-proxy/*`, `POST /cli-proxy/*`                                                                                                                                                                                                                                               | 60 req/min |

key は `X-Takos-Space-Id` があるときは `${ip}:${spaceId}`、なければ `ip`。429
response は common error envelope の
`{ error: { code: 'RATE_LIMITED', message, details: { retryAfter } } }` shape
を返し、`Retry-After` header も付与する。

## サンドボックス

runtime-service の sandbox env guard が **env var allowlist** を enforce する:

- 許可: `CORE_SAFE_ENV` (PATH/HOME/LANG 等), `GIT_ENV`, `CI_ENV`,
  `TAKOS_ACTIONS_ENV_ALLOWLIST` で追加した exact env 名または `PREFIX_*` 形式の
  explicit prefix
- 拒否: `BLOCKED_ENV` の一覧, `SENSITIVE_PATTERNS` (`AWS_*`, `JWT_*`, `TAKOS_*`
  等) にマッチするもの

runtime-service shared config の **command allowlist / blocklist** が dangerous
シェル commands を block する (`rm -rf /`, `reboot`, fork bomb, metadata service
SSRF パターン等)。`COMMAND_PROFILE=extended` で追加コマンドを opt-in できる。

## 制限値

`/exec` と `/actions/*` は別の execution path なので、制限値も分けて扱う。

| 対象            | 設定                               | 値                       | 備考                                    |
| --------------- | ---------------------------------- | ------------------------ | --------------------------------------- |
| `/exec`         | request timeout                    | default 300s / max 1800s | `exec-runner.ts`                        |
| `/exec`         | `MAX_EXEC_FILE_BYTES`              | 10 MB                    | staged input file 単体                  |
| `/exec`         | `MAX_EXEC_TOTAL_BYTES`             | 100 MB                   | staged input files 合計                 |
| `/exec`         | `MAX_EXEC_OUTPUT_BYTES`            | 5 MB                     | requested output file 単体              |
| `/exec`         | `MAX_EXEC_OUTPUT_TOTAL_BYTES`      | 20 MB                    | requested output files 合計             |
| `/execute-tool` | worker timeout                     | default 30s / max 60s    | `DEFAULT_TIMEOUT_MS` / `MAX_TIMEOUT_MS` |
| `/actions/*`    | `SANDBOX_LIMITS.maxExecutionTime`  | 60 min                   | workflow step execution                 |
| `/actions/*`    | `SANDBOX_LIMITS.maxOutputSize`     | 100 MB                   | stdout / stderr buffer                  |
| `/actions/*`    | `SANDBOX_LIMITS.maxConcurrentJobs` | 10                       | global / per-space job count            |
| `/actions/*`    | `SANDBOX_LIMITS.maxJobDuration`    | 6 h                      | job lifetime                            |
| `/actions/*`    | `SANDBOX_LIMITS.maxStepsPerJob`    | 1000                     | job step count                          |
| sessions        | `MAX_SESSION_FILE_READ_BYTES`      | 5 MB                     | code constant; env override はない      |

## エラー envelope

すべての endpoint は kernel と同じ common error envelope を返す:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "...",
    "details": {}
  }
}
```

`/execute-tool` も現在は同じ envelope に揃っている。`details` は必要な endpoint
だけが追加する任意フィールド。Git smart-http endpoint は成功時には Git protocol
response の media type/body をそのまま返すが、route validation や
`git http-backend` 起動失敗など runtime-service が生成する失敗 response は
common error envelope を返す。

## デプロイ

runtime-service container は backend-specific な runtime host process role
からマウントされる。container build は
`ghcr.io/takos/runtime-service:latest` で行い、env vars は Docker
secret + `runtime-service artifact secret file` で供給する。tracked
reference Workers backend での具体的な host worker / container 配置は
本ページ末尾の collapsible 節を参照。

## 関連ドキュメント

- [Control plane](/architecture/control-plane) — 親の process role / queue / cron
  全体図
- [Threads and Runs](/platform/threads-and-runs) — sandbox session lifecycle
- [Workflows](/reference/api#repos-actions) — GitHub Actions 互換 workflow API

## Workers backend reference materialization

::: details tracked reference Workers backend の実装詳細

> このセクションは Cloudflare Workers backend に固有の materialization
> detail。Core 用語との対応は
> [Glossary § Workers backend implementation note](/reference/glossary#workers-backend-implementation-note)
> を参照。

tracked reference Workers backend では runtime-service container は
`takos-runtime-host` worker (Cloudflare Container DO host) にマウントされる。

- runtime-service は CF worker ではなく **CF Container DO** として動く
- host worker (`takos-runtime-host`) は
  `takos/app/apps/control/wrangler.runtime-host.toml` で deploy する
- env vars は wrangler 経由ではなく Docker secret +
  `runtime-service artifact secret file` で供給する
  (`ghcr.io/takos/runtime-service:latest` 参照)
- kernel から runtime-service への呼び出しは Cloudflare worker 間 service
  binding (`RUNTIME_HOST`) で行う
- runtime-host worker は `/forward/cli-proxy/*` を container 内部 loopback
  (`127.0.0.1`) に中継する
- container runtime は internal loopback だけ `127.0.0.1` を立てるため、
  CLI-proxy loopback bypass の trust 仮定が production で成立する

`takos-runtime-host` という worker 名 / binding 名は本 backend の
materialization detail で、Core 用語ではない。Core 視点では runtime host は
process role の一つで、tracked reference では Cloudflare worker + Container DO
として展開される。

:::
