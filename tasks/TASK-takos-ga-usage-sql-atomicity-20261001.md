# Takos GA: atomic local usage recording and honest failures

Date: 2026-10-01 UTC
Owner: dedicated Takos session
Source base: 7f82dc35c870893e2a076812af121d37cfc30eda
Status: reviewed source and complete local gate verified; exact committed CI pending
Required for: production_or_release, authority (local usage ledger integrity)
Repository mutation scope: takos only; no shared contract change

## Boundary and sequence

Takos is self-hosted software for one instance owner. Local usage events and
period rollups belong to that installation, separate from commercial billing
owned by its account plane. No price, charge, entitlement, authentication grant,
production deployment or resource deletion is authorized here.

The current recorder inserts an event separately from its rollup. A failed
rollup leaves an event whose idempotency key prevents retrying the missing
aggregate. Run recording also swallows archive and SQL errors, and commits a
capped prefix as the fixed Run/meter event. The existing run-usage RPC already
returns HTTP200 with recorded:false when the recorder throws; preserve that
response contract and propagate failures to it.

1. Preserve original Takos/engine dirty work and other worktrees. Capture hashes.
2. Reproduce event-only writes, swallowed GET/decode/SQL failures, missing Run,
   and a 50,001-event partial result using real libsql and gzip fixtures.
3. Commit each event and its conditional rollup in one SQL transaction/native
   batch. Commit every Run meter together. Capture input/time before awaits and
   retain duplicate-vs-unidentified-event semantics.
4. Use an opt-in strict archive reader; reject corrupt/missing listed bodies and
   a 50,001st raw event before any SQL meter is written. Preserve the existing
   default prefix reader contract and unknown valid meter tokens.
   Reject duplicate catalog keys, empty bodies and nonfinite aggregate sums.
   A numeric overflow must abort the SQL group, not clamp or persist infinity.
5. Run focused tests, independent review, full bun run check and docs build.
   Return reviewed commit/PR/exact CI separately from live evidence.

Parent owns usage-recorder.ts, ledger and integration. usage_sql_regressions owns
only usage-recorder.integration.test.ts; usage_strict_archive_reader owns only
usage-events.ts and usage-events.test.ts. No contributor reverts another's work.
Use pinned Bun1.3.14, HDD priority/jobs2 and check heavy-build contention.

## Explicit remaining GA conditions

This bounded change does not prove full accepted usage. R2 excludes pending
events and may contain uncommitted writes. RunNotifier accepts late usage after
terminal events, so an R2 catalog or terminal Run is not a seal. Historical
partial fixed Run/meter rows also need explicit reconciliation. A separate
DO-owned accepted snapshot/revision, atomic cumulative projection, durable retry
and verified legacy baseline are needed before closing complete Run metering.
Token-source overlap policy and external producer stable retry identities remain
unqualified. Do not reinterpret existing event rows or introduce a new persisted
schema as part of this fix. No historical row or object is deleted or rewritten.

Evidence lives in ignored tmp/ga-usage-complete-20261001/. The first real-SQL
focused run has two passing compatibility cases and seven failing regressions,
including independently executed GET and decode failures. This is expected old
source failure, not a green current gate. Main owns real SQL/object-store atomic
qualification, live owner subject/initial install and final integration.

The old7f82 production modules and final tests are copied byte-for-byte into an
ignored baseline. The bounded selected regression run has2pass/12fail, with no
setup failures or timeout dependency. The initial broad baseline includes a
barrier timeout because the old recorder never enters withTransaction; keep
that diagnostic separate from meaningful red evidence. Production source hashes
and test hashes are recorded in baseline-manifest.json.

Raw and getDb-wrapped stateful fixtures use actual file-backed libsql SQLite,
handed transaction sessions, and an outer batch that refuses calls. Abort/retry
uses2transactions,0outerbatches and preserves zero rows before exactly one pair
on retry. The native libsql fixture separately exercises whole-Run atomic batch.
Concurrency and suspended input mutation retain one event and its original
owner/scope/metadata/period. Fresh fixture cleanup removes only its own files.

Bounded independent review caught a new post-commit read failure point for
unidentified events. Return the known successful commit immediately for these
calls; keyed calls may query their generated ID because their retries are
idempotent. A real native batch followed by an armed read failure verifies this
boundary. The numeric guard has separate real-SQL red evidence: finite operands
can overflow a rollup, so the NOT NULL column now aborts the group via CASE.
Binding the guard's maximum as a parameter violated edge.sql's portable range.
The reviewed fix uses a constant SQL literal; actual raw and getDb-wrapped
edge.sql adapters now each send a2-statement group through one real libsql
transaction and persist matching13.25units. A controlled parameter mutation
fails both tests; the saved exact post-commit-read source fails its own test.
The bounded final review found no additional confirmed P1/P2 after these fixes.
Final focused result is29tests/171assertions, all passing.

## Complete owner gate — 2026-10-01 06:10 UTC

Pinned Bun1.3.14 complete bun run check exits0 with owning engine mirror,
HDD jobs2/nice10/ionice2:7:1,527tests/244files/10,695assertions,20OpenTofu
tests/plans, all Rust check/Clippy/default96/mockaggregate169/build, mandatory
real Worker/full SQLite/ToolExecutor/debug-process replacement, Web and Worker
dry-run build. Local native legacy-KV proof38.109s observes200 and exact retained
head/R2 bytes. It does not prove the599 branch ran in this latest success.
Debug process binary SHAe7e2869f795be23a738fcb92ecf186396f9aaf78909df884ad123487f8790d0f
is a local executable witness, not a published image. Worker proof retains
tool2attempts/1operation/1artifact, model2, usage24/8/3, lease8/messages4/completed1,
checkpoint cleared and4stale RPC409s. Accounts/proxy verification, Container,
queue and live deployment remain outside that fixture.

Docs build3.30s and diff check pass. Declared types98/lint111 remain, undeclared0;
no exemptions, assertion weakening, phase skips or deadline widening. An initial
SQL select-alias diagnostic and a test-only unused generic were corrected; their
failed gate logs remain evidence, not success. Exact commit/PR/CI and final dirty
work custody are external to this ledger in the dedicated HDD result.

Evidence: tmp/ga-usage-complete-20261001/{focused-final.log,
baseline-red-bounded-final.log,baseline-manifest.json,numeric-overflow-red.log,
post-commit-read-red.log,edge-bound-mutation-red.log,independent-review-final.md,
full-check.log,full-check-final.log,types-first.log,types-detail-first.log,
docs-build.log,protected-before.json}. The edge-bound proof is an explicit
mutation of final source; do not call it a byte-exact old commit.

## Reversal

No migration is introduced. Reverting restores separate event/rollup writes and
the prior silent fallback; it does not undo committed usage or repair historical
partial rows. Product source and local tests cannot authorize live deployment.
