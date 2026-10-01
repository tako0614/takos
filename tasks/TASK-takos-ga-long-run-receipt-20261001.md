# Takos GA: long Run receipt capacity

Status: frozen focused/local native checks, independent final review and complete
local gate passed. Exact receipt commit and head CI are recorded in the dated
dedicated HDD result; do not infer them from local success.
Base: f6dbe1982ae63c96e150accd99a93de3bd7e1bb2.

## Scope and authority

Only the dedicated Takos worktree and its private logical journal change. Main
owns common contracts and final integration. Keep the existing legacy KV DO
namespace, outer notifier head, Run archive index and SQL schemas. No production
deploy, billing, identity grant, destructive existing-data operation, other
worktree edit or shared contract change is performed. Single-owner admission,
multiple private Workspaces and external participants remain unchanged.

## Problem and implementation order

The current logical schema 4 stores all emit and usage receipts inline. Every
lookup and snapshot grows with accepted requests, until the 8 MiB / 128-chunk
head plus future-plan reserve rejects more work. The earlier 50,001 archived
record fixture qualifies archive/usage behavior, not receipt capacity.

1. Add a private authenticated copy-on-write receipt tree with bounded nodes and
   exact opaque keys, payload digest and original emit event ID. Separate emit
   and usage identities. Legacy v1 keys retain their opaque duplicate result.
   Point lookup authenticates every node; missing/corrupt data fails closed.
2. Logical schema 5 keeps only bounded accepted deltas in the head. Receipt and
   event/counter or accepted usage totals/revision commit in that same head
   before acknowledgement. Do not evict keys, infer IDs from R2 or shorten the
   retry horizon. Keep explicit dedup_key priority and unkeyed-request behavior.
3. Persist an insertion plan before staging, verify immutable writes, then switch
   root and remove exactly the planned delta prefix atomically. Recover an
   ambiguous head outcome by authenticated readback; failed readback stops
   acceptance. Serialize maintenance with archive plans and preserve the
   existing future-plan reserve.
4. Resume schema 1-4 migration and authenticated retirement/GC through bounded
   steps and cold alarms. A deterministic bulk bootstrap plan retains all old
   inline data, stages/readbacks at most 16 nodes per alarm, and stores cursor
   progress in a small plan/source-bound durable sidecar. The large source head
   remains unchanged between batches. Cold restart authenticates every completed
   node before resuming. Switch root plus source arrays in one head after full
   closure authentication; a failed sidecar cleanup leaves only a bounded,
   nonauthoritative orphan.
   Adaptive leaves hold at most 64 entries/64 KiB, branches at most 8 refs.
   Keep all source data until the durable root owns it.
   Previously evicted historical keys cannot be reconstructed. New acceptance
   waits for migration; known duplicates retain their original result.
5. Update the offline candidate tool, closure inventory and retained-artifact
   restore boundary for schema 5 before claiming complete recovery. Preserve
   source-5 stages/repair/GC exactly; authenticate the completed bootstrap
   prefix and any present later nodes. Forward-pack large legacy inline
   receipts into an isolated schema-5 candidate using a full semantic identity
   digest when the old head cannot reserve migration metadata. Keep source
   bytes unchanged and the tool's explicit inventory limits. A source rollback
   to a schema 4 reader is insufficient.

## Verification and handoff

Fix a baseline at this exact commit and use the production serializer/DO to
show receipt-capacity rejection before the change. Then qualify additional emit
and usage acceptance, cold duplicate/conflict results for old and new keys,
unchanged counters/totals on retries, bounded authenticated point reads without
hot-path LIST, and the unchanged head/plan budget. Independently test node/head
faults, interrupted migration/GC, and exact offline candidate closure. Do not
weaken deadlines or treat preparation as successful qualification.

The parent owns integration, independent final review, the complete required
repository gate, exact committed bytes and exact-head CI. Heavy checks wait for
the main owner's build capacity; focused tests are limited to the changed
persistence behavior. Current terminal-usage qualification belongs to its
separate task and dated dedicated HDD result.

Ignored design/evidence: `tmp/ga-long-run-receipt-20261001/`. Live KV quota,
alarm/restart, remote restore, exact backend and published/deployed artifact
qualification remain separate GA conditions.

## Current preparation and preliminary checks

The byte-exact f6d baseline production serializer/DO fixture preserves a valid
near-capacity schema4 head but rejects the next emit and usage with 503. The
expected-200 behavioral test is red, with setup/characterization passing; this
is not receipt-capacity success. The new production migration/cold duplicate/
conflict fixture is prepared and waits for final notifier wiring.

Before new receipt fixtures, converter compatibility was 22 tests/135
assertions passing. The first new converter attempt had 30 passing cases and
one fixture error (expected capacity-error wording); the large forward-pack
behavior had not executed then. After correcting that fixture, the complete
two-file preliminary converter run passed 31 tests/347 assertions. The large
fixture retains all 10,243 effective identities, checks a full authenticated
closure against an independent expected list/digest, and samples cold point
paths without changing deadlines or the old-head capacity premise.

After adding the legacy filesystem variant, the two filesystem receipt cases
passed 87 assertions, preserving source files/manifest and caller-pinned
private custody. Parent converter lint passed with zero warnings/errors.
After notifier wiring landed, both converter files passed 32 tests/423
assertions (`converter-post-wire.log`). Runtime capacity tests first detected
48 node PUTs in one alarm against the intended 16-node cap. A temporary
64-node-cap green is preserved as diagnostic history, not accepted
qualification. The test again enforces 16 nodes/cursor advance per alarm and
a plan-derived maximum alarm count; the production owner has limited building
bootstrap to one maintenance step/alarm. Its final run remains pending.
The restored 16-node test then reached the unchanged default 5,000ms timeout
after 41 assertions. The large fixture/count, plan-derived alarm bound and
deadline remain unchanged; whole-source bootstrap recomputation is under
optimization. This attempt is not runtime capacity success. After parent
fixture binding/tuple type fixes, project-wide types passed with 0 undeclared
diagnostics and the unchanged 98 declared diagnostics across 33 files.
Converter-only independent early review found no concrete P1/P2; it performed
no tests/edits and does not approve the unfinished notifier or whole GA.
Readback: `converter-independent-review.md` in the ignored evidence directory.
These are preliminary mutable-source checks, not a frozen full qualification.
Core source, runtime capacity/alarms, full gate, final review, committed bytes
and new CI are still unqualified. Exact logs are
`converter-receipt-{preliminary,focused}.log`, `converter-forward-pack.log`,
`converter-filesystem-receipt.log` and `converter-lint-current.log`.

## 2026-10-01 12:35 UTC checkpoint

The repeated-source cache attempt still reached the unchanged 5-second timeout
after 50 assertions. It remains a failed capacity qualification. Bootstrap now
keeps its initial source head and writes small durable progress at
`run-receipt-v1/bootstrap-progress/<sourceDigest>`, bound to the exact plan SHA.
The capacity owner is adapting observation to the validated sidecar while
retaining the original fixture, 16-node/alarm bound, derived total alarm count,
and deadline. There is no runtime capacity success yet.

Recovery integration passed 8 cases/215 assertions, including ambiguous root
head writes, interrupted cold bootstrap, independent archive repair and warm
missing/corrupt receipt nodes returning private 503 without accepted-state
changes. Existing archive integration passed 13 cases/324 assertions after
bounded maintenance following accepted emit. A failed post-commit maintenance
must not revoke that accepted result; the 64-delta backpressure remains.

Latest converter checks passed 35 cases/453 assertions in both files, including
exact-copy filesystem bootstrap sidecars and invalid plan/source/cursor or
missing completed node rejection. After reusing the deterministic prepared
forward-pack batch, the same checks passed in 3.03 seconds
(`converter-prepared-cache-focused.log`); the previous sidecar run is retained
separately. No source fixture, inventory bound or deadline was relaxed.

The local native workerd harness is prepared with real production alarms,
legacy KV/R2, explicit eviction, cold duplicate/conflict and warm corruption
checks. It has not run and is not evidence of successful native recovery. It
requires a frozen source manifest first. Final independent review, full gate,
receipt commit and exact-head CI are still pending; f6d remains the latest
qualified commit/CI. Remote durability/quota, SQL, Container/artifacts and
whole-instance owner/client restore remain separate qualifications.

## 2026-10-01 12:39 UTC frozen checkpoint

Capacity now passed 2 cases/95 assertions in 3.64 seconds under the unchanged
default 5-second deadline. The valid near-reserve source head and >5,000
receipts remain unchanged; each alarm stages at most 16 nodes, retains inline
source until full authenticated root switch, and stays within the plan-derived
alarm count. Old/new emit and usage duplicates preserve original IDs/totals;
payload conflicts return 409 and point lookup uses no KV/R2 LIST. The empty DB
stub warning is expected and does not qualify SQL projection.

Core index tests passed 6 cases/51 assertions for exact namespace/control and
Unicode keys, collision rejection, worst-case escaped-key node caps, bound
sidecar tamper/prefix checks, ambiguous sidecar PUT readback, immutable node
faults and revived-node GC. Core types passed with 0 undeclared/98 existing
declared diagnostics. Runtime recovery remains 8/215; archive integration
13/324; converter 35/453. The 11 code/test files are frozen in the ignored
`frozen-code-manifest.json`; protected original/engine hashes still match.

Actual local native workerd legacy KV/R2/alarm proof passed in 13.486 seconds.
Real production alarms staged 16 nodes while retaining all source arrays and
an empty root. Explicit native eviction produced a new actor with durable
cursor16; its real alarm staged the remaining 8 nodes and committed all 391
identities. Old/new cold retries, conflicts, original IDs and usage totals /
revision were preserved. Injected own-fixture warm root corruption returned
private503 for both emit and usage without actor replacement or accepted-state
mutation. All eight native source hashes match the frozen manifest before and
after. Empty D1 warnings do not qualify SQL projection or remote quota.

Native attempt1 failed a strict cold cursor16 observation without recording
the cold snapshot. Its cause is unconfirmed; it is retained as a failed attempt.
Attempt2 added only that diagnostic trace before the same assertion and passed;
fixture, deadlines and production bytes did not change. Its retained result is
`native-receipt-proof/attempt-byvOPT/result.json`; both attempt logs and harness
are retained and fresh owned native storage was disposed. This is local native
qualification, not Cloudflare production lifecycle/quota, whole-instance
restore or deployed artifact proof. Final review/full gate/commit/CI remain
pending. `frozen-focused-evidence.json` records exact hashes and boundaries.

## First complete-gate attempt

The frozen implementation's first `bun run check` failed: 1,631 portable cases
passed and the existing native guard proof failed. Format, migration/static
checks, lint (0 undeclared/111 declared) and types (0 undeclared/98 declared)
had passed. The healthy historical fixture asked for new emit before receipt
migration, correctly received building503, and stopped; Rust/build phases did
not execute. `full-check.log` retains the complete failure, not a green gate.
The harness owner is adding explicit building-fence/no-mutation and bounded
production-alarm/ready preparation before the same event101/cold/fault checks.
No production source, invalid-state guard, deadline or existing assertion is
relaxed. A complete gate remains required after that fixture adaptation.

## Final local qualification — 2026-10-01 13:01 UTC

The native guard adaptation is confined to its healthy legacy Run fixture. It
proves exact building503 with raw head/R2 unchanged, then at most three explicit
production alarm calls to a ready authenticated historical root before the
existing event101, cold duplicate and archive root2 checks. Its raw outer head
is v2 and decoded logical Run snapshot is v5. Malformed guards, fault/race
windows, observer200/599 exact witness, cleanup and 90-second deadline remain.
Timed alarms are held only for that fixture; the separate receipt native proof
above qualifies actual local timed alarm delivery. One intermediate harness
run failed its incorrect raw-head version assertion; that failed log is retained.
Corrected focused native guard passed 1 case/33 assertions in 40.85 seconds.

Independent final review found no concrete P1/P2 across the original 11 frozen
receipt/converter code/test files or the additional guard fixture adaptation.
All hashes matched before/after each review. Final frozen manifest covers 12
code/test files. The original Takos dirty diff/status and engine candidate
source/diff hashes still match their protected snapshots.

Final `bun run check` exited0: 1,632 portable tests/252 files/11,816 assertions,
20 OpenTofu tests/plans, all Rust formatting/check/Clippy/default96/mock aggregate
169/build, mandatory real Worker/fullSQLite/ToolExecutor/checkpoint/process
recovery and Web/Worker dry-run builds. No phase was skipped. Native guard
41.406s/observer200; types98/lint111 declared and0 undeclared; source format1209.
Docs build passed3.30s. Actual Worker proof has tool2attempts/1operation/1artifact,
model2, usage24/8/3, terminallease8/messages4/completed1/checkpointcleared,
and four stale authority RPCs409. It still uses a local RUN_NOTIFIER stub and
substituted proxy verification. Local Rust debug binary SHA is
`8f244df07123671b337d2cbeef958a5040abe8f91aa8c849844868acb27a0205`.
This is distinct from a published Container image or future CI debug bytes.

Successful final log: `full-check-after-guard.log`; first failed gate remains
`full-check.log`. Reviews: `final-review-receipt.md` and
`final-review-native-guard-adaptation.md`. No exclusions, new debt or deadline
increases were added. Schema5 needs a matching retained reader/node/progress/head
or reviewed forward repair; source-only rollback to f6d's schema4 reader cannot
serve it. Commit/push/exact CI, target quota/lifecycle/SQL, published artifact
and whole-instance restore remain separate evidence boundaries.

## Exact c339 CI failure — 2026-10-01 13:10 UTC

The source-qualified change was committed/pushed as
`c339f67089e256e7954a693dc9842cf2ac840ba4` with 16 matching files and a clean
tree. Exact-head CI run36866129244 failed: 1,631 tests passed, while capacity
integration exceeded the unchanged 5-second deadline (5000.67ms). The same
source/fixture passed local fullgate, but that does not qualify CI. No blind
rerun, test count reduction, timeout increase or 16-node/alarm relaxation is
used. Runtime and fixture validation work are being profiled separately before
an evidence-backed bounded optimization. Raw CI failure is `ci-failed-c339.log`.
Current CI-qualified candidate remains f6d; c339 is not ready for integration.

## Capacity observation optimization — 2026-10-01 13:25 UTC

Read-only production profiling (equivalent5.03MiB/150node source) measured about
0.79 seconds. Exact fixture profiling retained8,542 receipts/5,242,368 bytes/
155nodes/11alarms and measured3.33 seconds; repeatedly decoding the same source
head before/after ten sidecar-only batches cost about1.25 seconds.

The test now captures an independent canonical raw head and every referenced
primitive journal-chunk value in its Map-backed fixture. Sidecar-only steps
must preserve those values exactly, proving the source arrays have not changed
without repeatedly decompressing/parsing the5MiB head. Initial/plan/final head
changes still use the production loader. Newly staged prefixes are authenticated
incrementally, with a complete prefix/closure verification at switch and the
same cold duplicate/conflict/IDs/totals/no-LIST checks. A negative case changes
a referenced chunk while keeping head JSON unchanged and requires detection.
This qualifies portable raw values, not native backend serialization/quota.

Runtime, converter and native guard bytes remain unchanged from c339. The same
near-reserve fixture, source identities,16node/alarm/cursor and plan-derived
alarm bounds, source retention and default5-second deadline remain. Focused
capacity passed3cases/98assertions in2.47seconds (original95 plus3negative-case
assertions); recovery8/215 remains green and scopedlint/format/diffchecks pass.
The test is frozen asSHA `f798a43eaa63390f99bb36cd43f4466d840b99a8da88df13b29de20820ac693f`.
Independent review, updated fullgate, new commit and exact CI are pending.
Logs/profile: `capacity-tests/{ci-timeout-stage-profile,capacity-final-rerun,
recovery-final-rerun,assigned-tests-oxlint-final}.log` and `perf-production.log`.

## Final observation qualification — 2026-10-01 13:34 UTC

The independent narrow review found no concrete P1/P2 or material assertion
weakening; frozen capacity SHA matched before/after. Raw-value immutability,
the changed-chunk negative case, original source/identity checks, incremental
new-prefix and final full-prefix/closure/cold authentication all remain. Report:
`final-review-capacity-observation.md`. Runtime/converter/guard source is
unchanged, so earlier exact native receipt/guard/source reviews remain applicable.

Updated complete `bun run check` exited0:1,633 tests/252 files/11,819 assertions,
20 OpenTofu, all Rust and mandatory Worker/process/build phases passed. Capacity
ran2.121 seconds; native guard46.641 seconds/observer200. Types98/lint111 remain
with0 undeclared; source format1209. Documentation bytes are unchanged from the
successful3.30-second build. Final local Rust debug SHA is
`964bcf7a8b3a44b6e0f8debe5d9f3297b1367058308f7b86c71235b2dd638f32`;
keep it separate from prior and future CI debug artifacts. Final log:
`full-check-after-observation.log`, SHA
`842c243ca653063ffad4e763be262b7f0c85096184233aca18a50c1ebb0bb840`.
The new test/metadata commit and exact-head CI are recorded in the dedicated
HDD result; c339's failed CI is retained and is not rewritten as success.
