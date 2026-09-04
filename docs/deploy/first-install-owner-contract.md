# First-install owner contract

Takos の first install coordinator が呼ぶ product-owned seam は
`bun run deploy -- --contract` の `ownerContracts` にあります。これは Takos を install
する default path ではなく、operator が選んだ Cloudflare integration target に対する
固定 operation です。free-form command、secret name、hook は受け取りません。

## Contract

`takos.first-install-owner-contract@v1` は次の 3 operation と result kind を固定します。

| operation | entrypoint | result kind |
| --- | --- | --- |
| `runtime-secrets-install` | `bun run deploy -- takos-cloudflare-production --runtime-secrets-install ...` | `takos.first-install-runtime-secrets@v1` |
| `functional-proof` | `bun run first-install:functional-proof -- ...` | `takos.first-install-functional-proof@v1` |
| `absence-proof` | `bun run deploy -- takos-cloudflare-production --absence-proof ...` | `takos.first-install-absence@v1` |

Runtime-secret result は output digest/source commit/operation id、output から導いた account と
Worker、固定 5 binding、各 attempt の `command-and-readback` または
`authoritative-readback-after-lost-ack`、完了時刻だけを返します。値、credential、private
path、provider の raw output は返しません。

## Authenticated functional proof

先に operator が通常の OIDC login と必要な human MFA を完了します。Takos の
`__Host-tp_session` cookie の **value だけ**を repository 外の canonical `0600` file に
置きます。proof はこの already-authenticated session file だけを受け取り、shared OpenAI
key、bearer token、password、MFA automation の fallback を持ちません。

```sh
bun run first-install:functional-proof -- \
  --environment integration \
  --public-url https://app.example.test \
  --source-commit <40 桁 commit> \
  --served-version <Worker version UUID> \
  --owner-session-file /operator-private/takos/owner-session
```

proof は anonymous `/health` と `/api/auth/me` boundary、owner の OIDC identity、setup
readback、temporary Workspace の create/list、thread/message/run、terminal
`completed`、nonempty run/assistant output を確認します。run request は model を指定せず
Workspace の resolved model を使い、`local-smoke` を拒否します。

実 container の evidence は `worker_id` ではありません。executor host が成功した internal
dispatch acknowledgement に bounded `X-Takos-Executor-Container-Id` を付け、queue owner が
既存の durable run-event ledger へ `executor_dispatch_receipt` を記録します。receipt は
`service_id`、`lease_version`、host-selected `executor_container_id`、`recorded_at` のみで、
proxy token metadata を含みません。owner-scoped `GET /api/runs/:id/events` から terminal 後も
読み取れます。proof はこの receipt が無い run を成功扱いしません。

temporary Workspace は成功/失敗の両方で削除し、delete の authoritative success が無ければ
proof 全体を失敗にします。初回 setup completion 自体は product state なので戻しません。

## Destroy-following absence

`--absence-proof` は retained exact OpenTofu output artifact とその SHA-256 を受け取る read-only
phase です。削除は一切行わず、owning OpenTofu destroy の後だけ実行します。

次の 22 row を個別に `absent`、`present`、`indeterminate` として返します。

- Worker、retained Worker version、route、custom domain、workers.dev
- D1 1、KV 1、R2 5、Queue 6、Vectorize 1
- executor Container application 3

list API は全 page を読み切った場合だけ missing name を `absent` とします。404 は
`absent`、存在 readback は `present`、timeout/authorization/parse/pagination failure は
`indeterminate` です。全体 status は present を最優先し、次に indeterminate、すべて absent
の場合だけ absent です。

```sh
bun run deploy -- takos-cloudflare-production \
  --absence-proof \
  --environment integration \
  --outputs /operator-private/takos/generation-2-destroy-outputs.json \
  --output-digest sha256:<retained output の SHA-256> \
  --source-commit <40 桁 commit> \
  --operation-id <coordinator operation id> \
  --cloudflare-api-token-file /operator-private/cloudflare/api-token
```
