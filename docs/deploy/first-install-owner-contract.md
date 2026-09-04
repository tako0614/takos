# First-install owner contract

Takos の first install coordinator が呼ぶ product-owned seam は
`bun run deploy -- --contract` の `ownerContracts` にあります。これは Takos を install
する default path ではなく、operator が選んだ Cloudflare integration target に対する
固定 operation です。free-form command、secret name、hook は受け取りません。

## Contract

`takos.first-install-owner-contract@v2` は orchestration lane を `integration`、Takos の
product environment を `staging` に固定します。既存 surface の名前
`takos-cloudflare-production` は owner contract identity であり、この operation が
production product environment を選ぶという意味ではありません。次の 5 operation と
result kind が完全な集合です。

| operation | entrypoint | result kind |
| --- | --- | --- |
| `runtime-secrets-install` | `bun run deploy -- takos-cloudflare-production --runtime-secrets-install ...` | `takos.first-install-runtime-secrets@v1` |
| `release-apply` | `bun run deploy -- takos-cloudflare-production --release-apply ... --execute` | `takos.first-install-release-apply@v2` |
| `release-status` | `bun run deploy -- takos-cloudflare-production --release-status ... --expected-served-version <uuid>` | `takos.first-install-release-status@v2` |
| `functional-proof` | `bun run first-install:functional-proof -- ...` | `takos.first-install-functional-proof@v1` |
| `absence-proof` | `bun run deploy -- takos-cloudflare-production --absence-proof ...` | `takos.first-install-absence@v1` |

Runtime-secret result は output digest/source commit/operation id、output から導いた account と
Worker、固定 5 binding、各 attempt の `command-and-readback` または
`authoritative-readback-after-lost-ack`、完了時刻だけを返します。値、credential、private
path、provider の raw output は返しません。

v2 の `releaseEvidence` は、canonical descriptor を最大 256 KiB、archive を compressed
64 MiB / expanded 256 MiB / 20,000 entry / path 4 KiB に固定します。Worker version inventory は
Cloudflare API v4 の `page/per_page`、Container application inventory は同 API の
`per_page/page_token` を使い、どちらも page size 100、最大 100 page / 10,000 row、完全 scan 2 回の
一致を要求します。descriptor kind/digest と release tag、executor image、public-agent image の
canonical pattern もこの value-free contract に含めます。

## Release overlay

`release-apply` は、digest で固定した staging OpenTofu output と canonical
`takos.worker-artifact@v3` descriptor を受け取る 1 回だけの writer です。descriptor は owner-private
regular file から最大 256 KiB だけ読み、その exact bytes の SHA-256 と physical identity を固定します。
呼び出し側が選んだ exact bytes の SHA-256 は `--expected-release-descriptor-digest` で必須入力にし、owner が
同じ file descriptor から読んだ digest と一致しない限り、archive fetch、provider read、account mutation の前に
拒否します。path を一度検査しただけの結果を mutation authority として引き継ぎません。
checkout は clean でなければならず、HEAD、`--source-commit`、descriptor の `commit` が一致し、descriptor
の `ref` と release tag も一致しなければなりません。archive は download 後に size と SHA-256 を照合し、
descriptor の executor/public-agent image は digest reference のまま receipt に束ねます。

archive は repository 外に新しく作った owner-private `0700` custody へ stream し、compressed
64 MiB、expanded 256 MiB、20,000 entry、path 4 KiB を上限にします。tar は UTF-8 の一意な
relative path と regular file/directory だけを許し、path traversal、duplicate、symbolic/hard
link、special entry を extraction 前に拒否します。required payload は
`worker/index.js`、nonempty `assets/`、`asset-manifest.json` です。archive、extracted Worker/assets/
manifest、realized config の全 closure を content digest と device/inode/ctime/mode/link count/size
で seal し、upload の直前と直後に同じ closure を再検証します。upload が使う main/assets/config
path はこの custody 内だけです。直前の差分は mutation 前の exit 2、upload 中または直後の差分は
mutation outcome が確定しない exit 3 です。

```sh
bun run deploy -- takos-cloudflare-production \
  --release-apply \
  --environment integration \
  --product-environment staging \
  --outputs-file /operator-private/takos/staging-outputs.json \
  --output-digest sha256:<retained output の SHA-256> \
  --source-commit <40 桁 commit> \
  --operation-id <coordinator operation id> \
  --release-descriptor-file /operator-private/takos/takos-artifact.json \
  --expected-release-descriptor-digest sha256:<caller が選んだ exact bytes> \
  --cloudflare-api-token-file /operator-private/cloudflare/api-token \
  --execute
```

成功 result の top-level key は次だけです。

```text
ownerContract, kind, status, operationId, orchestrationLane, productEnvironment,
sourceCommit, outputDigest, release, target, bootstrap, activated, attempt,
completeness, health, appliedAt
```

`outputDigest` は検証済み retained output file bytes の SHA-256 であり、Takosumi ledger の
digest ではありません。`ownerContract` は exact v2 kind、`release` は
`tag/descriptor{kind,digest}/archiveDigest/executorImage/publicAgentImage`、`target` は
`accountId/workerName/publicUrl`、`bootstrap` は OpenTofu output の `moduleVersion`、`activated` は upload
後に新しく配信された `servedVersion` です。`attempt` は exact `tag/message/versionId`、`completeness` は
complete stable inventory の method/bounds と exact-one readback、`health` は固定の
`{path:"/health",status:200}` です。secret、credential、private path、provider raw output は含みません。

upload acknowledgement を失った場合も upload は retry しません。upload attempt tag/message は
`kind/accountId/workerName/sourceCommit/outputDigest/operationId/releaseDescriptorDigest` の固定 key 順 JSON
から作る SHA-256 に固定します。writer は owner-private な target/account+Worker+operation scope の atomic
local lease を取り、その lease を absence から upload、exact unique readback まで保持します。既存の stale
または foreign lease は steal せず mutation 前に拒否します。この lease は同じ host の writer だけを直列化し、
provider に distributed CAS があるとは主張しません。

lease の内側で direct Cloudflare Worker Versions API の全 page を 2 回 scan して一致させ、exact tag/message
が不存在であることを確認します。その後だけ
`wrangler deploy --strict --containers-rollout immediate --tag <attempt> --message <attempt>` を 1 回実行し、
upload 後にも全 page の scan を 2 回一致させます。通常 acknowledgement と lost acknowledgement の両方で、
post-inventory の exact tag/message がちょうど 1 件、pre-inventory からの immutable addition もちょうど 1 件、
current version と immutable version detail が同じ UUID/tag/message である場合だけ採用します。page drift、0 件、
複数件、foreign concurrent addition、別の current version は exit 3 です。

採用した version は sealed realized config から導いた non-secret binding の完全 closure を満たす必要が
あります。これは全 `[vars]`、ASSETS、AI、D1、KV、R2、Queue producer、Vectorize、Durable Object、
TAKOS_EGRESS service と exact entrypoint を含み、unexpected/duplicate binding も拒否します。runtime
secret は別に固定 5 名の完全 closure として比較します。Container application は direct Cloudflare API の
全 cursor page を 2 回 scan して一致させ、canonical name の全集合が expected 3 件だけであり、unexpected/
duplicate application が無いことを証明します。その後に各 application の typed Wrangler detail で
name/image/version、health counters、`active_rollout_id` を照合し、全 3 application が release image、
ready/active、failed/starting/scheduling 0、active rollout 無しの場合だけ成功です。
`--containers-rollout immediate` は upload 時の rollout 方針であって完了証明ではないため、この complete
inventory と detail readback を省略しません。

bootstrap と異なる新 version、上記 binding/secret/Container closure、Vectorize、`/health` をすべて
証明できた場合だけ通常の成功 result を返します。証明できなければ exit 3 の `indeterminate` または
acknowledged upload 後の exit 4 で止まり、推測した version id は返しません。

`release-status` は apply 成功 result の `activated.servedVersion` を
`--expected-served-version` として受け取る read-only phase です。indeterminate apply の回復に
未知の version を推測する入口ではありません。

```sh
bun run deploy -- takos-cloudflare-production \
  --release-status \
  --environment integration \
  --product-environment staging \
  --outputs-file /operator-private/takos/staging-outputs.json \
  --output-digest sha256:<retained output の SHA-256> \
  --source-commit <40 桁 commit> \
  --operation-id <coordinator operation id> \
  --release-descriptor-file /operator-private/takos/takos-artifact.json \
  --expected-release-descriptor-digest sha256:<release-apply と同じ exact bytes> \
  --cloudflare-api-token-file /operator-private/cloudflare/api-token \
  --expected-served-version <release-apply の servedVersion>
```

status は bootstrap `moduleVersion` と、それとは異なる expected/served version の組だけを
release overlay として許可します。current deployment は structured JSON で 100% traffic の
単一 version でなければならず、人向け output から UUID を拾いません。version の exact binding closure、runtime secret の固定 5
名、Vectorize shape、direct API で全 cursor page を 2 回一致させた Container application の exact 3-name
closure と typed detail、image/health/active rollout、Durable Object migration、rendered config、`/health` を
typed data から比較し、legacy `drift` の prose は parse しません。
成功 result の top-level key は次だけです。

```text
ownerContract, kind, status, operationId, orchestrationLane, productEnvironment,
sourceCommit, outputDigest, release, target, bootstrap, activated, runtimeSecrets,
completeness, health, unrelatedDrift, checkedAt
```

`release.descriptor.digest` は apply と同じ sealed canonical descriptor exact bytes の SHA-256、
`completeness.containerApplications` は value-free な inventory method/bounds、2 回の complete stable scan、
exact 3 application、healthy detail 3 件、active rollout 0 を返します。`runtimeSecrets` は値を持たない
`{provisioned:true,present:[固定 5 名],missing:[]}`、`unrelatedDrift` は `[]` です。別の drift が
1 つでもあれば active result を返さず post-condition failure にします。release operation は
owner-session を受け取りません。owner-session は次の functional proof だけの authority です。

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

session を読む前に public origin の DNS answer を 1 回だけ解決し、private、loopback、link-local、
reserved、mixed answer をすべて拒否します。その safe answer の 1 address を全 request に pin
し、TLS SNI と HTTP Host は元の hostname のまま検証します。redirect、別 origin に解釈できる
path、30 秒を超える request、全体 5 分、4 MiB を超える response は拒否します。したがって
request ごとの再解決や redirect に owner cookie を渡しません。

実 container の evidence は `worker_id` ではありません。executor host が成功した internal
dispatch acknowledgement に bounded `X-Takos-Executor-Container-Id` を付け、queue owner が
既存の durable run-event ledger へ `executor_dispatch_receipt` を記録します。receipt は
`service_id`、`lease_version`、host-selected `executor_container_id`、`recorded_at` のみで、
proxy token metadata を含みません。owner-scoped `GET /api/runs/:id/events` から terminal 後も
読み取れます。proof はこの receipt が無い run を成功扱いしません。

temporary Workspace は成功/失敗の両方で削除し、delete の authoritative success が無ければ
proof 全体を失敗にします。初回 setup completion 自体は product state なので戻しません。
CLI の exit 2 は mutation attempt 前の refusal、exit 3 は lost acknowledgement、未確認の
mutation、または cleanup outcome が不明な場合、exit 4 は mutation の acknowledgement 後に
functional post-condition が成立しなかった場合です。exit 3 を自動 retry しません。

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
