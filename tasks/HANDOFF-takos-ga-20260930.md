# Takos 専任から統合への引継ぎ — 2026-09-30

Takos 全体の GA は未完了。この引継ぎは source と実環境の証拠を分ける。
配置・課金・権限変更・削除の許可は追加しない。

## 最新の追加: quality 子プロセスの完了確認 — 2026-10-01

必須 type/lint gate が捨てていた終了状態を検証する。固定 tool の通常診断終了値
（TypeScript2/oxlint1）と正常完了0を区別し、signal/想定外終了値/通常値と矛盾する出力/
stderr を拒否する。lint JSON の必須 shape と supplied location を確認し、TypeScript の
file header/正規の二字単位 indent を除く stdout を拒否する。raw両streamを保持する。
既存の診断台帳/countdownを変えず、新exemption/quarantineやtimeout変更を加えない。

exact1c33 source の controlled CLI fixture は、declared debt出力後のweb137/lint137と
正常値でもfatal stdoutが混じるケースをold0/current1に再現。実OOMを発生させた証明でも
過去CIの実失敗を示す証明でもない。SIGTERM、stderr、壊れたlabel/span、正規multiline、
台帳vanished/increased/undeclaredの12tests/65assertionsは成功。最終独立レビューに
新たなblocker無し。全必須 local gate は1,577tests/248files/10,969assertions、
20OpenTofu、全Rust、必須Worker/fullSQLite/process復旧と両buildまで成功。
native42.656s/observer200、docs build3.59s、types98/lint111未申告0。
exact新commit CIの結果は専任HDD resultに記録する。
詳細: [quality process task](TASK-takos-ga-quality-process-20261001.md)。

source/runtime課題も継続: 未受理terminal notifier emitではSQL usageだけが永続化し、
DO dirtyが無いため投影が回復しない。検索info_unit jobの成功/DLQと使用量を結び付けず、
terminal CASと原子的な専用outbox、独立claim/retry/readbackが必要で、まだ未実装。
長Run receiptはinline配列・snapshot容量とO(N)処理が限界。bounded head delta＋認証済
receipt tree/再開可能な移行/GC/converter対応が必要で、key evictionやR2からのID推測は
しない。このquality修正でruntime/基盤/live/全体GAを完了とはしない。

## 前段の追加: accepted Run usage と single-owner 集計 — 2026-10-01

Run accountId は Workspace ID。メーターの所有者は Workspace.ownerAccountId を参照し、
space_id に Workspace を保持する。旧 wrong-owner 固定行は自動移管せず修復待ちにする。
一人の所有者の複数 Workspace と外部参加者/共有を維持し、新規課金・認証grantは加えない。

Takos-private logical journal schema4 に accepted totals/revision を加え、usage の pending/
receipt と同じ head へ保存してから ACK する。終了後の追加も保持し、terminal は seal と
みなさない。旧履歴は受理済み frontier と pending/intent を凍結して bounded に検証・集計。
欠落/不正/説明不能な object は durable repair とし、部分値を SQL 成功にしない。
SQL は fixed Run/meter key の cumulative MAX と rollup SUM を一つの atomic group に保存。
先に deterministic rollup lock を取得し、通常 writer との競合を防ぐ。旧 partial 行も現在の
同一所有者/scope に限り再集計できる。応答消失や古い revision の ACK は新しい dirty を消さない。
内部 DO operation/alarm で cold retry し、offline candidate でも ledger と dirty を保持する。

実 SQLite 付き DO/R2 fixture で 50,001 archived records+pending、bounded alarm/cold restart、
終了前後・duplicate・SQL failure/lost ACK・新規受理中の旧 projection ACK・numeric loss を確認。
原本9e source の wrong owner/frozen later tokens と schema4 不保持を red に再現した。
raw/wrapped edge.sql、SQL atomicity/identity/overflow/mixed writers を検証し、独立レビューで
見つかった3件を修正。全必須 local gate は1,565tests/247files/10,904assertions、20OpenTofu、全Rust、必須
Worker/fullSQLite/process復旧、両buildまで成功。types98/lint111未申告0、native44.634s/
observer200、docs build3.26s。exact commit CI の最終結果は dedicated HDD result に記録する。
詳細: [accepted usage task](TASK-takos-ga-accepted-usage-20261001.md)。

logical schema を新 reader より前へ戻す source-only rollback は不適切。保存 export を保持し
reviewed forward repair/conversion を使う。live backend/alarm/PG concurrency、producer retry ID/
token重複policy、長Run receipt容量、実owner-sub/mobile、公開artifactと実ユーザー導入/復旧/
監視は残る。Takos全体GAを解除せず、共通契約/他tree/本番/料金/権限/既存データを変更しない。

## 前段の追加: app-local usage の原子性と失敗応答 — 2026-10-01

event と条件付き rollup を同じ SQL transaction/native batch へ入れ、Run の全メーターも
まとめて保存する。実 SQLite で旧 event-only 失敗と再試行不能を再現し、新しい部分記録を
防止した。archive/SQL 失敗・missing Run・50,001件目の検出を既存の recorded:false 応答へ
伝え、部分集計を成功にしない。strict 読取は opt-in で、不正・欠落・空 body・重複 key を
拒否する。未知の有効 meter と従来 prefix reader は保持。料金・権限・共通契約・schema
変更や過去データの修復・削除は無い。

raw/ラップ済 stateful SQL の専用 session、実 edge.sql adapter の atomic group、同時再送、
入力snapshot、数値 overflow、commit後の不要な read failure を検証した。限定独立レビュー
の2件を修正し、追加確定P1/P2無し。対象29tests/171assertions、全gate1,527tests/
244files/10,695assertions、20OpenTofu、全Rust、native38.109s（observer200）、必須
Worker/fullSQLite/process復旧と両build、docs build/diff checkは成功。
詳細は [usage task](TASK-takos-ga-usage-sql-atomicity-20261001.md)。exact commit/CI は
専任 HDD result に記録する。pending/終了後 usage の完全集計、歴史的部分記録の修復、
producer retry/token重複policy、実 backend 資格は未完了。Takos全体GAの解除ではない。

## 前段の追加: finalized Run archive migration witness — 2026-10-01

自動移行も、正の `r2LastFlushedSegmentIndex` に対応する最終 key・segment を認証済み
索引で確認してから ready にする。元 head が確定済みと示す body がなく、リングが全て
pending に残る場合の false200 を実 RunNotifierDO テストで再現し、修復待ちへ変更した。
counter/ring/pending/frontier と現存 gzip を保持し、再起動後も新規 emit を503で拒否する。
合法な segment/event ID 欠番は維持。全過去履歴の完全性・消失復元・live切替の証明ではない。

固定29eda sourceの最終回帰は11pass/2fail、新sourceの実クラス13tests/324assertionsは成功。
必須全gateも1,504tests/243files/10,544assertions、20OpenTofu、全Rust、native40.060s、
実Worker/fullSQLite/process復旧、両buildまで成功。docs build/diff checkと限定独立レビュー
を確認した。exact commit/PR/CI は dedicated HDD result と
[task ledger](TASK-takos-ga-archive-closure-20261001.md) に記録する。
163aのCIでは注入head例外のnative resetが同時の観測requestを599にした。test-only観測は
このexact例外だけ扱い、ACK200/id1・実instance交換・fault回数・ring/pending/intentの
key/count/blob digest/bytesを必須にした。一般の599・retry・sleep・deadline緩和・native例外
隠蔽はない。限定独立レビューと再全gate成功。exact new-head CIは専任結果に記録する。
共通 binding/API、認証・権限・課金操作、他 worktree、production target は変更しない。
long Run receipt 容量と usage 完全集計は未解決の別項目として残す。

## 前段の追加: offline Run archive candidate — 2026-10-01

`scripts/run-archive-candidate.ts` は operator が保存した private export を読み、Run 一件の
履歴を圧縮・展開それぞれ8 MiB以内の gzip と schema3 ready head に再分割する。
callerが指定したmanifest SHAを必須とし、ID/type/data/created_at、counter/ring/receipt、
usage pending/intent/blob と usage object bytes/metadataを保持する。任意SQL witnessは
不透明なbytesのまま保持し、SQL last_event_idをR2保存範囲とみなさない。
source head/chunk、既存index、staged insert、既知pending/receiptとの矛盾は拒否する。
candidateのcold実RunNotifierDOとindexed readerで全件digestを照合してからsealする。

候補は**新しい隔離namespace用**であり、同じcanonical keyに異なるbytesが入る場合がある。
元bucket/prefixへのin-place applyは禁止。source filesはread-only、出力は新規private
directoryのみ。symlink/hardlink、path escape、重複inventory、途中のfile変更、既存出力を
拒否する。apply/upload/deployは実装しない。入力manifestは選んだcopyの整合性であり、
live snapshotの真正性・完全性を証明しない。全instance/他Run closureとtarget切替は主担当。

実filesystem CLI proofは10,555,545 compressed bytes/14,010,445 expanded bytesの旧gzipを
用いた。現行production readerは503/repair、変換後は6,283,054と4,272,543 bytesの2gzipに
分かれ、85eventをcold readerで全件照合できた。元head/gzip/manifest SHAは不変。
このsynthetic export/local adapterの成功をlive export、backend quota、SQL reconciliation、
全instance restore、公開/deployed artifactの証拠にしない。

検証・独立review・exact commit/CIは専用HDD resultに記録する。
詳細: [candidate task](TASK-takos-ga-archive-candidate-20261001.md)、
[operatorの候補作成手順](../docs/architecture/run-archive-candidate.md)。
残る長Run receipt、usage50000超、実owner-sub/mobile、target lifecycle、guard-aware retained
artifactとlive user journey/restoreはGA解除条件のまま。他worktree/主handoff/controlに変更なし。

## 前段の追加: Run archive index — 2026-10-01

Takos 内部の認証済み B+tree 索引を実装した。公開 replay/SSE と InfoUnitIndexer は
内部 `/archive` を使い、ready 後は R2 全 catalog を列挙せず必要な exact gzip だけ読む。
挿入計画を node 書込より先に保存し、root 更新・pending prefix 除去・退役記録を同じ
外側 v2 head へ保存する。Run の論理 snapshot は3、Notification は2。
再起動・曖昧な head 保存・GC・途中 cursor・受理前の容量予約を検証している。

50,001 個の実 gzip/key を持つ同じ Map backend で、byte-identical な旧 a841 reader は
正しい tail event5,000,100 を得るまで51 LIST/1 GET、現在は tree4 point GET/0 LIST と
R2 1 GETで同じ tail を得た。旧 source の50,000件切捨ては再現せず、その失敗を主張
しない。実証したのは全 catalog 列挙の仕事量と bounded query の差で、native backend の
容量・性能資格ではない。test/log/source hash は専用 ignored evidence に記録した。

旧履歴は32 key/page・8 step/request/alarm の building から再開可能に移行する。
不正 key/body、重複範囲、既知 pending/ring との矛盾はデータを保持して repair にする。
元の整数 counter から全 ID の存在を推測しない。移行が証明するのは現存 body と既知
witness であり、過去消失の復元・SQL 全 witness 照合・旧 writer 停止ではない。
32768 cursor および圧縮/展開8 MiBの上限がある。旧200 MiB readerで読めた大きい
segment も offline repair が必要。上記の候補作成道具は追加済みだが、live export・適用・
全instance復旧の検証は未完了。

独立レビューで index/GC、root/pending の atomicity、reader pagination に残る P1/P2
は無し。local native workerd で cold `/archive` の exact digest/root を確認する。
ACK と asynchronous offload は別なので、native fault proof は test-only waitUntil barrier
で処理終了を待ってから観測する。待機は本番 endpoint の追加ではない。
最終 local `bun run check` は1481 tests/241 files/10387 assertions、20 OpenTofu、全 Rust、
必須実 Worker/SQLite/ToolExecutor/process recovery と両 build まで成功。native proof は
20 observations/58.430s。types98/lint111 の既存 debt、未申告0、新 exemption無し。
初回 alarm が16 stepになる失敗を旧 source で確認し、8 stepへ修正して全体 gateを再実行した。
Docs build/diff checkも成功。exact commit/CI は専用 HDD result の新 head 記録を参照する。

Main には exact-version cutover/quiescence、遅延 R2 書込/SQL照合、single-key head と
R2/conditional-create/alarm/restart/quota の target 資格が残る。長 Run receipt、usage
50000超の集計、owner-sub/mobile-sub、published/deployed image と real user journeyも
未完了。source成功をこれらの証拠に流用しない。他 worktree/control/主handoff は変更しない。
詳細: [index task](TASK-takos-ga-run-archive-index-20261001.md)、
[保存と移行の正本](../docs/architecture/notifier-journal.md)。

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

## Usage archive body reads — 2026-10-01 01:51 UTC

The existing usage reader fetched/decompressed all segments before applying its
event cap. It now reads sorted bodies sequentially and stops at the cap. Required
prefix failures still reject; missing/empty segments still continue. NaN uses the
default10,000 instead of disabling the cap. Ordinary lower/upper/fractional limits
are preserved. Invalid progressing cursors reject instead of looping indefinitely.
No usage producer, pricing, billing, permission or persisted schema change is added.
The emit helper has no production caller in this repository; stable usage retry
identity must come from an actual producer and is not claimed as wired end to end.

Final regressions fail against byte-identical 6430d9ba production source; a direct
valid10,001-record gzip witness shows oldNaN10,001 versus current10,000. Current
six focused tests/20assertions and independent scoped review pass. Complete local
bun run check succeeds:1,444tests/237files/9,037assertions,20OpenTofu,allRust phases,
mandatory real Worker/fullSQLite/ToolExecutor/process recovery,Web/Worker builds.
Types98/lint111 stay declared with zero undeclared findings. No timeout/assertion
or phase is weakened. Protected original UI and short-worker engine dirty remain
intact. See TASK-takos-ga-usage-archive-reads-20261001.md and ignored
tmp/ga-usage-archive-20261001/; exact commit/CI is returned in the dedicated result.

Capacity still open: all catalog keys are listed/sorted, six-digit key rollover,
long Run receipts and real backend/subscriber performance. Existing run-usage
aggregation's50,000 cap and SQL-token fallback policy are unchanged; completeness
above that cap is not proven. A Takos-owned authenticated durable index can use
existing point storage/R2 reads, but upgrade fencing, immutable-page integrity,
restart/GC and both observation/indexer consumers need implementation and proof.
This source fix does not qualify GA, shared backend lifecycle, first-install
owner-sub/mobile correspondence, published images or live user journey/restore.
