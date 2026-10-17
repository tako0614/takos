# Takos GA: finalized Run archive migration witness

Date: 2026-10-01 UTC
Owner: dedicated Takos session
Status: complete local source gates and bounded final reviews verified; exact new CI pending; target integration remains open
Source base: 29eda5cd588f3aba2dd7305dee6f5f27f76da777
Required for: production_or_release
Mutation scope: Takos source and new local proof files only

## Problem and boundary

Legacy migration checks retained ring events, but all those entries can still be
pending. A nonzero `r2LastFlushedSegmentIndex` then permits a missing finalized
archive body to go undetected: the runtime can publish `ready` for an empty or
older-prefix index. The offline candidate already rejects missing known frontier
keys; the automatic runtime must also refuse this false completion.

Before building becomes ready, authenticate the final indexed descriptor with a
bounded DO point query. It must match the nonzero finalized segment index and
canonical key from the retained head. The producer advances segment keys and
event IDs monotonically; preferred event IDs and segment keys may have gaps.
Unknown zero legacy frontiers do not establish historical completeness. This
check proves the retained finalized marker has a verified body in the index,
not that every historical event or unknown deleted interior object exists.

Failure enters durable repair, preserves the counter/ring/pending/frontier and
existing object bytes, and refuses new input. No source object is rewritten or
deleted, no shared binding/API or persisted schema changes, and no live repair,
deployment, grant, money operation or publication is authorized here. Main owns
backend qualification, quiescence, whole-instance closure and live recovery.

## Ownership and validation

Parent is the sole writer of run-notifier.ts, run-archive-integration.test.ts and
related docs/ledger. archive_tail_design reviews these changes read-only.
Preserve the original dirty repository and every other worktree. Use pinned
Bun1.3.14; heavy gates use HDD, jobs2/nice10/ionice2:7 after checking contention.

Reproduce the false200 with the production DO class and real gzip bodies, then
verify missing last/all bodies, durable repair after replacement, refusal of
new emits, unchanged retained state and source bytes, and valid sparse IDs.
Run the focused suite, mandatory complete `bun run check`, docs build and diff
check. Record reviewed commit/PR/exact CI separately from unpublished artifacts
and unverified live owner/first-install/Run/recovery evidence in the dedicated
handoff. Long Run receipts and complete usage aggregation remain separate work.

## Verification — source163a77d7e, 2026-10-01

The byte-exact29eda5cd5 source with the final regression test returns false200 for
both missing all bodies and an older-prefix catalog:11pass/2fail. Its RunNotifier
source SHA is c153e7070689b47a4dafc80df6febe08875f426031f6c5a908896870392c884a.
The fixed actual-class suite passes13/13 with324 assertions, including both cold
repair cases and legitimate sparse keys/IDs. Source gzip and accepted state are
preserved; no timeout/assertion was weakened.

Complete pinned `bun run check` succeeds:1,504tests/243files/10,543assertions,
20OpenTofu tests/plans, all Rust compile/Clippy/default96/mockaggregate169/build,
mandatory actual Worker/fullSQLite/ToolExecutor/debug-process replacement and
Web/Worker dry-run build. Native legacy-KV workerd proof passes in52.319s.
Debug binary SHA9ce76d49925135ba12acd59348b0a5c6389f8041016439ee384bb6b62f1c6959
belongs to local process proof, not a published container. Docs build/diff check
pass. Existing types98/lint111 debt remains; undeclared diagnostics0, no new
exemptions. Initial type failure caused by capturing runId was corrected by using
that validated value consistently after awaits; the failure log is retained.

The bounded independent final diff review found no additional confirmed P1/P2.
It does not establish unknown interior history or later external object writes.
Baseline setup-only missing-core and broad Bun path-filter failures are kept
separate from the meaningful regression; final proof uses explicit file paths.
Original Takos dirty diff/status and engine candidate source/diff hashes match
the preceding protected evidence. Main retains live restore/backend/identity
responsibility. Long Run receipts and complete usage/rollup accounting remain
unimplemented separate work, with read-only findings retained in ignored proof.

Evidence: tmp/ga-run-archive-closure-20261001/{baseline-red-final.log,
focused-final.log,full-check.log,full-check-first-types-failure.log,docs-build.log,
independent-review-final.md,residual-source-findings.md,protected-before.json}.
Exact commit/PR/CI and final custody are recorded in the dedicated HDD result.

## Exact CI follow-up — source163a77d7e

Exact CI36818271888 failed only the native head-fault observer: the deliberately
injected head put exception resets native blockConcurrencyWhile and can abort
concurrent test-only /control/settled with599 and that exact exception. The native
contract explicitly resets a DO when this callback throws:
https://developers.cloudflare.com/durable-objects/api/state/#blockconcurrencywhile.
This does not establish accepted state loss; no production behavior change is
indicated by this evidence. Failure log and exact run readback remain retained.

Parent owns scripts/prove-notifier-state-guard.ts and its test for the bounded
follow-up. Keep the observer strict200 by default. Only the deliberately armed
head-fault case admits599 with the exact injected nativeError. Require prior
emit ACK200/id1, pre-emit ID, actual replacement after599, exact fault counters,
counter/ring/pending and intent key/count/blob bytes/digest, followed by the
existing independent explicit eviction, alarm retry, equal gzip and intent
retirement. No generic599, timed polling, sleeps, deadline widening or masking
native callback exceptions. The independent design review approved this boundary;
final bounded diff review found no additional confirmed P1/P2. Complete new local gate passes; exact new CI is pending.

Final observer source full gate succeeds:1,504tests/243files/10,544assertions,
20OpenTofu, all Rust phases, mandatory Worker/fullSQLite/debug-process replacement,
Web/Worker dry-run builds. Native proof40.060s records observer200 plus exact
head/R2 witnesses; native599 branch remains for exact new CI confirmation.
Pinned Bun/priority/jobs and declared types98/lint111 debt are unchanged.
Final local debug binary SHA0472e68d9b69f3957a79ed0b77f57cb708f144436f4518369b10133e57d6cb43; not a published image.
Evidence adds full-check-observer-final.log, native-observer-fixed.log and
independent-review-native-observer-final.md. Failed163a CI remains historical
failure evidence; do not relabel it as success. Final commit/CI custody is external
to this ledger so no self-referential commit ID is invented.
