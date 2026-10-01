# Takos 専任から統合への引継ぎ — 2026-09-30

Takos 全体の GA は未完了。この引継ぎは source と実環境の証拠を分ける。
配置・課金・権限変更・削除の許可は追加しない。

## 担当と保護した作業

- Takos 専任: この `dev/takos-ga-20260930-1737` branch と専用 worktree。
- 主担当: Takoserver、共通契約、最終統合。Takosumi と yuru family は別担当。
- 元 `/root/dev/takos/takos` の chat/feed/model/tool-label の未commit差分は読んで
  境界を確認した。コピー、stage、commit、reset はしていない。
- 旧 adapter/notifier/install 等の worktree は採用・完了・削除可能と判断していない。
- 主の `/root/hdd/takos-dev/handoffs/takos-ga-owner-20260930.md`、control の
  `docs/handoff/product-sessions-20260930/{README,takos}.md` と
  `docs/quality/product-maturity-work-20260930.md` を読んだ。
  control のローカル文書を Git 同期済みとは扱わない。

## 今回の source 成果

開始 HEAD `43b5fe68` は古かったため、remote readback で確認した main
`1da7a7d0e5e3d6a0c552cd29976c0fc9abe9105b` を専用 branch へ統合した。
元 checkout は変更していない。

- `e71164fd0`: Node SSE の replay 正本を永続 timeline に統一。
  notifier 再起動・ring eviction 後の履歴と terminal cursor を復旧し、通知は
  永続履歴の再読込を起こす。2000件の page と client pull で読み込みを制限し、
  terminal/error/disconnect 時に subscription と timer を解放する。
- `de7708852`: 現行 main を統合。upstream の全 portable-test discovery を維持。
- `8fb9a25b9`: install CTA の複数行 shell 表示を契約テストで正規化。
  完全なコマンド引数と順序の検査は維持する。
- 配置文書: 通常の OpenTofu module、optional disposable bridge、Takos 所有の
  production entrypoint の担当を明記。`--vectorize` は index 作成、`--apply` は
  Worker upload と Container 反映、`--containers` は読み戻し。
  container-enabled DO bootstrap はこの二つの phase では補えず、optional bridge の
  別途 bootstrap と container-ready namespace の読み戻し、live 資格確認が残る。

検証の詳細は [SSE task ledger](TASK-takos-ga-sse-recovery-20260930.md)。
現行 code commit `8fb9a25b90c00f7eaa4753d9b646ca6f729ecdd5` の `bun run check`
は Bun 1.4.0 で成功した。1316 Bun tests、20 OpenTofu mock-plan tests、全 declared
format/drift/schema/static/type/architecture/build phase が通過。
既存 ledger の lint 112件、TypeScript 98件は残るが、未申告 diagnostic は0件。
配置文書変更後の `bun run docs:build` も成功。独立 Sol review で具体的な
P1/correctness P2 は指摘されなかった。draft PR は
[Takos #126](https://github.com/tako0614/takos/pull/126)。commit `a89bc5267baedecea9ddf8ba9ce98e823ba15564`
の remote `bun run check` も 2026-09-30 18:37:50 UTC に成功した
([CI run](https://github.com/tako0614/takos/actions/runs/36759733899))。
これ以降の追加差分の CI、release、deploy の証拠へ流用しない。

## 製品の確認 journey

既存 owning contract に基づく受入候補。製品全体の新しい共通 GA gate ではない。
Worker が Thread/history/Run/tool operation/checkpoint/lease の正本を持ち、
container は run-scoped executor、engine は library とする。

| Journey | 必要な source 契約と受入候補 | 今確認した証拠 / 残る確認 |
| --- | --- | --- |
| Login | `identity.oidc`、同一 browser state/nonce/PKCE、Accounts の実 client と session | `node-resolver-oidc.integration.test.ts` は模擬 OIDC。実 Accounts login/client grants 未確認 |
| Workspace → Thread | DB/session と space access、`POST /api/spaces/:spaceId/threads` | public API の local proof source はある。live owner session での作成は未確認 |
| Thread → Run | `agentContainers` capability、固定 model、DB と versioned `RUN_QUEUE`、executor dispatch と terminal status | `agent-proof.test.ts` 等の component tests。現在の artifact に結び付いた queue/container 実行は未確認 |
| MCP admission | `mcp.server/2025-11-25`、declared/resolved endpoint、streamable-http、現在の Ready Principal binding と `mcp.invoke` | runtime-interface/exposure tests。live Interface/Binding revision、tools/list と tools/call は未確認 |
| Tool safety | Worker catalog/schema/policy と correlated operation ledger、side effect の不確定 outcome は再実行しない | `idempotency-uncertain.test.ts` 等。実 remote backend での proof は未確認 |
| Checkpoint → executor replacement | lease-CAS checkpoint、protocol v2、inline 上限超過時 `TAKOS_OFFLOAD`。旧 executor を止め、新 lease が prior checkpoint から再開する | mock RPC の wrapper tests に加え、実 Worker handlers / full migration SQLite / Rust executable process の中断・再開を確認。同じassertionを固定Dockerfile imageの2つのlocal OCI initでも確認。toolは2回RPC・1回成果物、旧lease4RPCは409、新leaseでatomic completion。published image / native・Host Container backend / queue / proxy authentication / remote backend は未確認 |
| 観測と復旧 | 永続 timeline の cursor replay、terminal closure、実 binding/resource/image/version readback、監視と復旧 | 今回 SSE 15 tests を追加・確認。実 Redis/offload、負荷、alert、restore drill は未確認 |

正本: [runtime service](../docs/architecture/runtime-service.md)、
[Thread/Run](../docs/platform/threads-and-runs.md)、
[managed Interfaces](../docs/deploy/runtime-interfaces.md)。
`scripts/local-agent-proof.ts` の bootstrap identity は実 OIDC login の証拠ではない。
`scripts/first-install-functional-proof.ts` の存在と mock test 成功も、実行成功ではない。

## 必要な graph と統合待ち

[product-resources.json](../deploy/product-resources.json) は provider-neutral な
製品要求であり、published Form refs や Host admission の証明ではない。
現在の唯一の install module は `deploy/opentofu/cloudflare`。
Cloudflare provider `= 5.19.1`、OpenTofu `>= 1.5`、Worker compatibility date
`2026-04-01` は source 宣言。稼働先の資格確認ではない。

| 製品要求 | 正確な runtime binding / 契約 | 残存作業と owner |
| --- | --- | --- |
| Worker・DB・session・KV | `DB` (`sql.binding.v1`)、`SESSION_DO` (`stateful.binding.v1`)、`HOSTNAME_ROUTING` (`keyvalue.binding.v1`) | Takos は adapter/consumer を所有。Host上は主が選んだ exact Form/Binding と backend lifecycle/readback が必要 |
| Object storage | `WORKER_BUNDLES`、`TENANT_BUILDS`、`TENANT_SOURCE`、`GIT_OBJECTS`、`TAKOS_OFFLOAD` (`object.binding.v1`) | 共通 object primitive の資格は主。checkpoint/offload consumer と復旧は Takos |
| Queues/DLQ/schedules | `RUN_QUEUE`、`INDEX_QUEUE`、`TAKOS_NOTIFICATION_PUSH_QUEUE` (`queue.binding.v1`)、3組の Queue/DLQ、2 Schedule | source graph と queue handler は Takos。exact delivery/retry/DLQ/schedule backend の実 lifecycle は主との integration 待ち |
| Stateful service | `RUN_NOTIFIER`、`NOTIFICATION_NOTIFIER`、`RATE_LIMITER_DO`、`ROUTING_DO` (`stateful.binding.v1`) | Actor/DO の exact admission と HTTP/WSS/storage/restart proof が必要。Takos専用Host分岐は追加しない |
| Executor | `EXECUTOR_CONTAINER`、`EXECUTOR_CONTAINER_TIER2`、`EXECUTOR_CONTAINER_TIER3` (`service.binding.v1`) | Container backend の exact lifecycle/route/image/health は主との integration 待ち。Takos は control RPC/checkpoint/lease と consumer を所有 |
| Semantic retrieval | `VECTORIZE` (`vector.binding.v1`) と embedding model | current native provider gap と Host Vector backend は別。無い場合の disabled は source 契約であり完全機能の証拠ではない |
| Identity/UI/MCP | manifest `takosumi.com/v2.4`、`identity.oidc` callback `/auth/oidc/callback`、launcher `interface.ui.surface@1` + `ui.open`/none、MCP `mcp.server/2025-11-25` + `mcp.invoke`/none または supported oauth2 | Accounts/InterfaceBinding の実 readback は Takosumi owner と連携。既存 scope/delivery の解釈や権限を変更しない |

OIDC scopes は `openid profile email offline_access capsules:read capsules:write`。
runtime secret 名は `ENCRYPTION_KEY`、`TAKOS_AGENT_START_TOKEN`、
`TAKOS_INTERNAL_API_SECRET`、`PLATFORM_PRIVATE_KEY`、`PLATFORM_PUBLIC_KEY`。
値は読まず、作成・更新していない。

Takoserver への現在の具体的な source は、Provider `= 4.0.0` の opt-in
[fetch tracer](../deploy/opentofu/takoserver-fetch-tracer/README.md)。対象は
`takoform_module_worker`、`takoform_worker_bundle`、`takoform_worker_version`、
`takoform_worker_deployment`、`takoform_worker_endpoint` の5 resources と
`edge.forms.takoform.com` の discovery identity。実行時の definitionVersion /
schemaDigest は exact readback で固定する。fetch-only、`fullRuntime: false` であり、
これを製品の full graph、Actor、Vector、Container の実行証拠へ拡張しない。

**主への提案:** 上記 graph に対応する現行 published Form/Interface/Binding の
exact package closure と対象 backend を選定し、足りない契約は中央で決定する。
Takos側にはその closure を使う full-runtime adapter/consumer qualification が残る。
version と schemaDigest の未選定を「Hostが未対応」と断定しない。解除には、その exact
closure の admit/activate readback と create/update/delete、HTTP/WSS、復旧の runtime proof
を必要とする。自製品内 source/UX/docs はこの待ちと独立に進める。

## 短期 engine 成果と次の独立作業

`ga-takos-agent-engine-20260930` の `src/engine/session_engine.rs` を照合済み。
base `0a1216b22d8d175c0735dadef54573eadc252d2a` に62行の履歴 regression test追加。
runtime/API は変更しない。差分 SHA-256 は SSE ledger に記録した。
未commitの候補を外部 worktree で保持し、そこは変更していない。
この専用 worktree の ignored qualification context に base を archive し、候補差分を
適用して library の complete `bun run check` を確認した。Rust 1.97.1、MSRV 1.85.0、
Bun 1.4.0 で format / Clippy / rustdoc / compile / 212 tests / build が成功。
その後、この専用 worktree 内の独立 canonical clone に同じ差分を採用した。
owning commit `d1ec9a3616bb905aaf0eb8f53310faf745abe4cc`、
[engine draft PR #4](https://github.com/tako0614/takos-agent-engine/pull/4) を作成済み。
採用先で再度 complete gate を Bun 1.3.14 / Rust 1.97.1 / MSRV 1.85.0 で確認し、
212 tests と全 phase が成功。その exact commit の
[CI](https://github.com/tako0614/takos-agent-engine/actions/runs/36768782117) も
2026-09-30 19:55:32 UTC に成功。元の候補 worktree は未commit差分を同じhashで保全した。
merge は統合待ち。詳細は [engine採用ledger](TASK-takos-ga-engine-adoption-20260930.md)。

Takos image の engine source pin は `containers/agent/engine-source.json` の
`c4c3c9f0ffc3956a917b8da38f97671dbd3aea2d`。
その pin から候補 base までの committed diff は4つの文書だけだった。
`scripts/release-artifact-deploy.ts` は exact pin を fetch して image context を作る。
最新 main という理由だけで pin を変更しない。今回の wrapper gate はこの exact pin を
Git archive し、現在の wrapper source と Rust 1.94.0 で検証する。候補の62行の追加 test
を image に混入させない。root `bun run check` / CI に wrapper の default / mock-LLM
tests、compile / Clippy / production executable build を追加した。

新たな2つの replacement proof は、実 checkpoint を保存して acknowledgement 前に旧
executor task を中断し、新 lease を渡す。`execute_tools` では2回のRPCが同じkeyを使い、
fixture ledger は1回だけ操作を実行し、履歴とusageを保持して完了する。
`run_model_external_context_after_tools` は pinned engine の `RecoveryUnsafe` 契約に従い、
追加model / toolなしで failed atomic completion する。実Worker ledgerの証拠ではない。
詳細は [wrapper task ledger](TASK-takos-ga-agent-wrapper-gate-20260930.md)。
追加後の root `bun run check` は CI と同じ Bun 1.3.14 で成功。
1,322 Bun tests、20 OpenTofu tests、wrapper default 96 tests、mock-LLM 169 tests、
compile / Clippy / executable / web / Worker build を確認した。docs build も成功。
lint 112件 / TypeScript 98件の既存 debt は残り、未申告は0件。
独立レビューの fixture 競合と child proof の未実行/無期限待機を修正し、再確認済み。
code commit `04d883e297a46b7ccf6006ec147e98a66ae6ef77` を PR #126 に push 済み。
その expanded [CI run](https://github.com/tako0614/takos/actions/runs/36766362568) も
2026-09-30 19:35:02 UTC に成功し、exact engine checkout と Rust 1.94.0 の全 gate を確認した。
CI の結果は対象 commit と照合する。release / image / deploy の証拠にはしない。

追加の必須 `scripts/prove-agent-worker-recovery.ts` は、実 Worker dispatch / ToolExecutor / SQL
operation ledger と、同じ executable bytes から起動した2つの OS process を通す。
tool の SQL commit 後に HTTP acknowledgement を保留して旧 process を終了し、
新 lease が保存済み checkpoint の同じ operation key / loop ID から完了する。
1 artifact / 1 completed operation、2 model calls、usage 24/8/3、4 durable messages、
1 completed event、checkpoint clear を focused proof で確認した。
モデル・proxy token は local fixture、notifier は no-op sink であり、SSE 配信の証拠にはしない。
proof 全体の watchdog と gate の POSIX process-group 上限も必須。独立 review の
cleanup / executable provenance / late child registration 指摘を修正した。
追加後の complete `bun run check` も Bun 1.3.14 で成功。
1,326 Bun tests / 6,751 assertions、20 OpenTofu tests、Rust default 96 / mock 169
tests、全 static/type/compile/Clippy/build と実 Worker/process proof を確認した。
lint 112 / TypeScript 98 の既存 debt は変わらず、未申告は0件。
gate が実行した executable digest は
`a7670d6d9c09a35588338ca7029cdaad186aa694ad78e4a60f69f799191c8ce6`。
これは debug executable の local proof であり、published image digest ではない。
独立 final review の具体的な P1/P2 は残っていない。
docs build も成功した。ログはこの worktree の ignored
`tmp/ga-sse-recovery/worker-recovery-{check,docs-build}.log` に保持する。
code commit `4159b8895c58e6097ecfc221cf1592c459334800` を PR #126 に push 済み。
その exact-head [CI](https://github.com/tako0614/takos/actions/runs/36772813753) も
2026-09-30 20:31:13 UTC に成功し、実 Worker/SQL/process proof の実行を確認した。
merge / published image / deploy は未実施。元の Takos UI dirty と engine 候補差分は
再照合して保全を確認した。この worktree は code commit 時点で clean。
記録だけの head `b1939ccc9` は既存の SessionDO env-builder 統合テストが9.2秒かかり、
既定5秒の上限で [CI失敗](https://github.com/tako0614/takos/actions/runs/36773414829)。
全 migration を含むこのテストだけ30秒の明示上限に変更し、state / alarm解放の
assertion はすべて維持した。runtime / identity / schema は変えない。
変更後の focused test は1/1成功。complete gate も同じ件数で再成功し、実 Worker/SQL
復旧 proof まで確認した。独立 review でこの対象限定の上限を確認済み。
最新の CI は PR head と照合し、古い成功 run を最終HEADへ流用しない。
対象限定の上限変更 commit `00ffa2f44cb9c01c40de2c917ff97d5d593e93a0` の
[CI](https://github.com/tako0614/takos/actions/runs/36774446313) は
2026-09-30 20:45:23 UTC に成功した。後続差分の証拠には流用しない。
詳細は [実Worker復旧ledger](TASK-takos-ga-worker-wrapper-recovery-20260930.md)。

容量調査中に、terminal event 150 の後で event ID から閉じた segment 2 に戻り、
次の境界で151–200を捨てる RunNotifier の欠落を再現した。live index と incoming index
を最後の成功 flush より先へ正規化し、既存の旧bufferも次のkeyへ保存する。
13件の focused test で warm/cold/旧state/連続terminal/保存失敗の再試行、閉じたgzip
bytesの不変性と cursor page を検証した。独立 review の具体的P1/P2は残っていない。
この追加差分の complete `bun run check` もBun 1.3.14で成功した。
1,331 Bun tests / 7,590 assertions、20 OpenTofu tests、Rust default 96 / mock 169、
全phaseと実Worker/SQLite/process復旧proofを実行。lint 112 / TypeScript 98 の既存debtは
変わらず、未申告は0件。code commit `bbb92a2afa408f4a4010d77858dac28baa98cec9` の
[CI](https://github.com/tako0614/takos/actions/runs/36777999424) は
2026-09-30 21:16:49 UTC に成功し、PR #126 の当時のheadと照合済み。
この成功を後続差分の証拠へ流用しない。
既に消えた履歴の復元と、put成功後にDO state保存だけ失敗する境界は未検証。
詳細と主への契約提案は [offload integrity ledger](TASK-takos-ga-offload-integrity-20260930.md)。

次の独立作業は Node SSE の subscriber/history 規模別容量確認と、実 Container artifact の
中断後再開資格確認。engine候補の owning commit / PR は作成・検証済み。
元 worktree を保全したまま統合へ戻す。test-only のため image pin は更新しない。
通常の Node executor event は一秒 polling に依存し、一部通知だけが即 wakeup する。
offload/DO read の subscriber 数に応じた負荷を GA 解除済みとは扱わない。
offload helper は各 page/poll で run の全 segment keys を list してから cursor で絞る。
末尾100件を読む local paginated bucket の回数測定では、過去1,000 / 10,000 / 50,000
segmentに対してlist 1 / 10 / 50回、body GETは各1回。backend latencyや実subscriber
負荷の証拠ではない。native R2はprefix/opaque cursorを提供するがseek-keyは提供せず、
SQLのlast_event_idもobject commit境界ではない。共通のexact backendでordered range-list
を資格確認するか、durable archive indexの失敗・復旧authorityを主で決める提案を記録した。
共有契約の変更とHost専用分岐は追加していない。今回の欠落修正は全列挙の容量問題を解決しない。
native/mobile、published/deployed identity、実 user journey、監視/復旧は未検証。

## 状態復元と検証対象の追加修正

状態読込の失敗を空の状態として受け入れる別の欠落を再現した。既存100件のarchiveを
持つRunNotifierのcold起動でreadが失敗すると、旧sourceはterminal emitをID 1として
HTTP 200で受け、segment 1を上書きする。初期化Promiseの失敗を保持・再throwし、
fetch/alarm/hibernation callbackを復元完了まで待たせる変更で、既存stateとgzip bytesを
保護した。実RunNotifierを含む19 focused testsは成功、同じ最終testを旧sourceへ適用した
red proofは16成功/3失敗。独立reviewの具体的P1/P2は残っていない。

このred proofをignored tmpへ残した全体gateで、Gitの正しい対象227ファイルをBunの
path filterが405ファイルへ広げるrunner不備も発見した。実helperへ`./`付きのfile pathを
渡し、ignored同名testがthrowする子process回帰で確認した。探索・quarantine・対象testは
削減していない。旧source archiveを残したまま全体gateは1,335 Bun tests/228 files/
7,699 assertions、20 OpenTofu tests、Rust default 96/mock 169、全phaseと実Worker/
SQLite/process復旧proofを通過した。既存debt lint 112/TypeScript 98は変わらず、未申告0。
詳細は [状態復元ledger](TASK-takos-ga-notifier-restore-20260930.md) と
[テスト対象ledger](TASK-takos-ga-portable-selection-20260930.md)。

その code commit `f5207eb193d71f28a2fc1895e2a213a725bddf82` の
[CI](https://github.com/tako0614/takos/actions/runs/36782775728) も
2026-09-30 22:01:54 UTCに成功し、1,335 tests/228 files、新しい回帰と実Worker復旧proofを
raw logで確認した。docs buildも成功。後続Container proof差分にはこの結果を流用しない。

R2 put成功後のDO state保存失敗、legacy KVの1値128 KiB上限、壊れたstate形状の検証は
この修正で解除していない。immutable flush intentとchunked stateのschema/rollback設計は
次のTakos内作業であり、実backendのatomic storage契約・失敗復旧は主との資格確認が必要。
容量の全segment列挙問題も残る。共有契約の変更は行っていない。

実Container artifact資格確認は専用HDD builderで進行中。Dockerfileのlocked release buildを
維持し、Cargoの既定同時jobを2へ制限するbuild argumentを追加・独立review・実RUN probeで
確認した。検証済みcommit `f5207eb19` とengine pinの固定treeからimage buildが成功した。
manifestは `sha256:4fba7740a515e902a67a623c9ff2ac4c4afd73e442a80abe4e47957e8d86f3e8`、
全config/layerの物理digestも照合済み。umociのpreflight bundleはimageのUID/GID10001と
Cmd/workdirを保持する。二つの実local OCI initで中断・再開proofも成功した。
UID/GID10001と同じimage bytesを保持し、旧initのPID/start ticksとrunc stateが消えてから
leaseを更新する。tool呼出し2回/成果物1個、usage24/8/3、4 durable messages、completed
event1個、新leaseだけのatomic completion、旧lease4RPCの409と無変更を確認した。
終了後は両initと自身のstateの消失を確認済み。13件のfault testsでprepare/create中断、
PID再利用/zombie、停止失敗、null一覧、stdout/stderrを確認し、独立reviewもclear。
初回実行のrunc empty-list不備は失敗ログを保持して修正した。local candidateを公開済みimageや
native/Host backendの証拠へ昇格させない。専用builderはbuild後に停止・reap済み。
この追加sourceの全体gateも1,348 Bun tests/229 files/7,770 assertions、20 OpenTofu tests、
Rust default96/mock169、全phaseと既存の実Worker/debug-process復旧proofまで成功した。
既存debtはlint112/TypeScript98で変わらず、未申告0。exact new-head CIは別途照合する。
既存Docker daemon/他担当BuildKit/他worktreeは変更していない。現行public descriptorの
旧imageを今回のbytesの証拠として代用しない。詳細は
[Container資格ledger](TASK-takos-ga-container-qualification-20260930.md)。

## Single-owner alignment and notifier state guard — 2026-09-30 follow-up

User's product premise is authoritative: each person deploys Takos for themselves,
one instance owner. Multiple private Workspaces, public/password share recipients,
external communication and MCP counterparties remain separate concepts. The
existing private-Workspace owner witness was coherent; generic admission of every
new OIDC subject and cached legacy cookie was not.

The operator now pins OIDC_OWNER_SUBJECT against OIDC_ISSUER_URL before login.
Callback, opaque bearer/PAT, existing cookie, pending MCP callback, queued/active
Run control and delayed app-owner device push use that boundary. Missing/invalid
pin refuses admission. Former-owner device delivery settles the outbox and retains
its notification/pusher rows; missing config retains pending delivery for retry.
No first-public-visitor enrollment, email merge, Workspace-membership owner guess,
new upstream client grants, credential issuer or automatic subject alias is added.

Both auth provisioning paths use one account+identity batch. Real libsql owner and
legacy-profile regressions, cookie-cache status changes, a second Principal's valid
private Workspace/Run, and pending MCP/push delivery are covered. Current tests
against pinned 3b79815 production source reproduce eight failures in those entry
boundaries (34 pass / 8 fail); the auxiliary new helper is present only because new
tests import it, and the old production paths never invoke it. The current API
scope fixture carries the owner pin so its scope assertions still execute; rejected
UserInfo/id-token tests also prove their upstream requests actually run.

Notifier snapshots are completely validated before installing state; only absent
undefined is fresh. Legacy unversioned and schema1 continue, future/malformed
versions fail closed across fetch/alarm/hibernation. Safe sequence and segment
limits refuse invalid requests before mutation. Native workerd legacy-KV/local-R2
proof reproduces old-source future/null/false overwrite, then proves current state
and gzip conservation plus actual eviction/counter/dedup recovery. It does not
qualify native storage quota or remote SQL/R2 semantics.

Complete check and exact-commit CI evidence are returned in the dedicated result
file and PR126. Local OCI recovery was rerun with the current owner-fenced Worker
handlers and the previously frozen f5207eb image manifest 4fba7740...: two tool
attempts retain one operation/artifact, completion lease8 and four stale RPC409s.
Image build inputs and engine pin remain unchanged; this is not an image rebuilt
from the whole current Worker commit. The earlier artifact's proof-source hashes
remain historical; the new ignored container-owner-recovery.log records this rerun.

Remaining integration work: establish the owner's exact registered-client sub
before exposing login, confirm browser/mobile pairwise subject behavior with
Accounts, and select/admit/activate the exact product resources on the target
backend. identity.oidc's four existing public fields are unchanged; the owner pin
is Takos app configuration, already projected by the existing OpenTofu env map.
The source guard is a prerequisite for a future durable journal, not a deployed
rollback fence. R2-write/state-write failure, immutable flush intent, payload chunks
and byte budgets, archive listing capacity, published images and live user
journey/recovery/monitoring remain open.

See TASK-takos-ga-single-owner-20260930.md and
TASK-takos-ga-notifier-state-guard-20260930.md. No original/other worktree, shared
contract, production target, billing authority or external resource was changed.

Local gate qualification boundary: the current complete check attempt passes
1,409 portable tests / 231 files / 8,888 assertions, 20 OpenTofu tests, declared
lint112/types98 with zero new diagnostics, and all Rust phases, then stops at
the mandatory debug proof's full-SQLite migration deadline150s. HDD journal
commit wait was observed. The same owner's OCI recovery succeeds separately.
No deadline or assertion was weakened. Full committed CI is the separate complete
gate evidence; the local composite failure log is retained and must not be called
green. Current docs build succeeds.


## Durable notifier journal — 2026-10-01

Takos-private v2 state now uses immutable64KiB chunks, exact gzip flush intents
and one verified head. R2 success followed by head failure no longer loses the
committed pending prefix or permits cold replay to overwrite it. Legacy-only
semantic adoption persists observed actual gzip bytes before finalization; new
v2 intents require raw-byte equality and conditional create/readback. Serialized
finalization retains later accepts. Ambiguous heads reload before further work;
failed reads or bad shapes retain data and refuse operations. Capacity8MiB/128
refs rejects before ID advancement; accepted pending entries are not evicted.
Alarms are armed before pending publication and before staging; verified cleanup
removes only unreferenced internal copies, including idle failed-stage orphans.
No shared schema/binding/Form or deployed data conversion is performed.

The single owner's notification DO keeps100 replay-horizon receipts keyed first
by canonical SQL notification_id. Arbitrarily old refresh hints may replay with
new cursors; the SQL inbox remains one fixed-ID row. Actual libsql verifies both
ambiguous cold retry and retired replay keep the exact original row. The long-lived
stream does not permanently exhaust receipts. Run/usage receipts remain bounded
by capacity and are not evicted; usage retry identity is optional and caller-owned.
The architecture entry now explicitly repeats the personal single-owner premise,
multiple private Workspaces and independent external participants/shares.

Complete local bun run check now succeeds:1,438tests/236files/9,017assertions,
20OpenTofu tests/plans, all Rust phases(default96/mockaggregate169), required
real Worker/full SQLite/ToolExecutor/debug-process recovery, Web+Worker builds.
Native18-scenario journal/guard proof passes34.16s. Source type debt98 is unchanged,
lint debt111 is reduced by one; zero undeclared diagnostics. Docs build succeeds;
independent review findings are resolved. Test timeouts and assertions unchanged.
Actual fff1ff922 native old-source witness reproduces R2-success/head-failure/cold
same-key gzip overwrite with hashes; current native cold retry conserves gzip.
Native conditional-create conflict returnsnull and keeps competing bytes/pending.
The local KV quota probe accepts133120bytes, so production quotas are unqualified.

These close the earlier source-level intent/chunk/budget/save-window items, not
GA or live backend qualification. Main must establish single-key durable head,
authoritative reads/conditional create, actual quotas/alarm/restart and retained
guard-aware rollback artifact on the exact admitted backend. Current Takos S3/GCS/
in-memory put adapters ignore onlyIf; do not claim that guarantee there. Long Run
receipt exhaustion/performance, archive listing, owner-sub/pairwise mobile-sub,
exact Form/Interface/Binding closure, published image and live journey/monitor/
restore remain open. No other worktree, original UI/engine dirty data, common
contract, billing, grants, production deploy, image publication or merge changed.
See TASK-takos-ga-notifier-journal-20261001.md; exact new commit/CI are recorded in
/root/hdd/takos-dev/handoffs/takos-ga-dedicated-result-20260930.md and draftPR126.
