# Takos GA: authenticated Run archive index

Date: 2026-10-01 UTC
Owner: dedicated Takos session
Status: source reviewed and locally verified; exact-head CI recorded in dedicated HDD result
Source base: a8411bb315c62abefdc7031577e3a85307b96abd
Required for: persisted_schema, production_or_release, authority
Repository mutation scope: takos only

## Product and authority boundary

Takos is personal software deployed for one instance owner. Private Workspace
ownership and external participants/shares remain separate. This task changes
Takos-private Run history storage and readers, not a shared Form/binding contract,
client grant, pricing or backend resource. Main owns exact target qualification
and integration. Preserve original UI dirty work and the existing engine result;
do not edit any other worktree. No deploy, image publication, merge, operator
credential changes or production data deletion is authorized.

## Required outcome and order

1. Revalidate source, main handoff, control status and protected original work.
2. Implement a bounded content-addressed Merkle B+tree over existing DO KV point
   reads. Store exact R2 key, event range/count and gzip digest/size per segment.
3. Journal a bounded insertion plan before staging nodes. Publish the new root
   and remove its exact pending prefix in one existing commit-head update.
4. Implement resumable bounded legacy backfill, explicit building/repair failure,
   authenticated retirement and restart-safe cleanup; never clear accepted data
   to create capacity. New Run snapshots use logical schema3, outer head remains2.
5. Switch both public replay/SSE and InfoUnitIndexer to the internal indexed DO
   endpoint and verified exact R2 GETs. Keep SQL terminal fallback; errors do not
   silently close a terminal stream while pending history is inaccessible.
6. Demonstrate old full-list work growth, prove current cold/fault/scale
   behavior with real production classes, independent review and full owner gate.
7. Return exact commit/PR/CI and residual backend/live/legacy evidence limits.

## Invariants

The current v2 outer bufferState head remains the only commit point. Only the
logical Run snapshot upgrades to3; NotificationNotifier stays2. The head contains
bounded root metadata and an optional bounded node insertion plan. Every staged
node is hashed and read back before publication. Exact R2 write/readback precedes
root publication. Pending prefix deletion, root update and retirement witness
commit together. A head failure reloads authoritative state; failed reload refuses
operations. An old cold reader rejects logical3 instead of treating it as fresh.

Event IDs may jump legitimately through preferred SQL IDs. Descriptor ranges must
be strictly ordered and non-overlapping; never require every integer below the
counter to exist. Missing/corrupt nodes or required bodies fail closed. Point
query cost is bounded by tree depth and requested descriptors, with no R2 list.
R2 bytes, strict decoded event count/range/order and exact key are revalidated.

Plan-before-stage avoids untracked failed-stage nodes. Retired node hashes are
authenticated in an immutable record referenced by the same head as root change.
Query traversal and cleanup serialize. Cleanup is idempotent and advances its
head witness before retiring the record; ambiguous writes reload first. Backlog
backpressure preserves live nodes. No whole-tree scan occurs on each query/append.

Legacy migration uses a durable building phase and bounded steps rather than a
constructor network scan. New accepts/flushes pause while building. Existing
pending/intent/receipts remain intact. Enumerate existing R2 once, parse exact
numeric keys, validate bytes and overlaps, reconcile known pending/ring/intent
witnesses, and publish after completion. Unknown or conflicting physical objects
are repair cases, not silently adopted. New readers refuse incomplete building;
no permanent full-list runtime fallback remains after cutover.

Migration is capped at32 keys/page,8 steps/request or alarm with a20-second
start budget,32768 cursor hashes and8MiB compressed/decompressed segment bytes.
All remote reads have separate deadlines; a step already started may finish after
the start budget. Decoding integrity failures are permanent repair; transport and
read/decompression deadline failures remain retryable. The3MiB future plan reserve
also reserves48 chunk descriptors, not just bytes, before ACK.

## Evidence limits, rollback and dependencies

Legacy backfill proves an exact index of present validated objects and current
pending, not recovery of every historically acknowledged event. Counter alone
cannot prove historical completeness. Prior versions may already have lost data.
SQL witness reconciliation is not implemented by this index migration; SQL
terminal rows still merge in the reader. Legacy200MiB decoded segments may exceed
the new8MiB bound. They require an offline conversion/restore tool and verification,
still unfinished; canonical documentation describes the required non-overwrite
candidate conversion, not an implemented or applied production repair.
An already-running old writer does not honor the new building fence. Main must
qualify exact-version cutover/quiescence and reconcile late old writes before
target conversion, along with head durability, authoritative R2 reads, conditional
creation, alarms, quotas, restart, retained guard-aware artifact and restore.

Old a841 source rejects logical3 on cold start; rollback below that fence needs
offline restoration or forward repair. A retained/deployed fence is unproven.
There is no production migration or deployment in this source task. Long Run
receipt capacity, usage aggregation above50,000, remote subscriber performance,
owner-sub/mobile correspondence and complete live journey remain separate items.

Official references retrieved on2026-10-01: Cloudflare legacy KV storage API,
alarms, known issues and Workers best practices. Existing portable bindings remain
the owning source contract; no new provider-specific API or SQLite migration is
added. Node values are conservatively bounded below the documented legacy value
limit; actual target quotas still need qualification.

Primary references:
- https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/
- https://developers.cloudflare.com/durable-objects/api/alarms/
- https://developers.cloudflare.com/durable-objects/platform/known-issues/
- https://developers.cloudflare.com/workers/best-practices/workers-best-practices/

## File ownership and verification

run_archive_tree owns only new run-archive-index.ts and its tests. Parent owns
RunNotifier, logical schema/migration/GC, task/handoff and integration. Reader
ownership is assigned separately before edits. Each file has one writer and all
contributors preserve unrelated work. Evidence is kept in ignored
tmp/ga-run-archive-index-20261001/. Complete gate uses pinned Bun1.3.14 and owning
engine mirror on HDD, jobs2/nice10/ionice2:7, after checking competing builds.
No test/deadline/phase weakening or new diagnostic exemptions.

## Verified source outcome — 2026-10-01 UTC

Final complete `bun run check` exited0 with Bun1.3.14 and the pinned owning engine
mirror:1481 tests/241 files/10387 assertions, all20 OpenTofu tests/plans, full
Rust check/Clippy/default96/mockaggregate169/build, mandatory real Worker/full
SQLite/ToolExecutor/process replacement, and Web/Worker dry-run builds. Native
legacy-KV workerd proof passed20 observations in58.430s, including cold archive
exact key/digest/range checks. Declared type debt98 and lint debt111 remain;
undeclared diagnostics0 and no new exemptions. Docs build and diff check passed.
No phase, assertion or deadline was weakened. Owned proof processes were absent
on completion. This is local source proof, not a deployed artifact or live target.

The initial alarm advanced16 migration steps although its budget was8. The final
production-class34-segment test failed9pass/1fail against the exact pre-fix source,
then passed10/10 after null/building alarms shared one `ensureArchive` budget.
The full gate above covers that fix. Read-only independent Sol review found no
remaining material P1/P2 in index/GC/root-pending atomicity, reader pagination or
this final alarm correction.

A separate50,001-distinct-gzip fixture built the actual production index at
height4 and performed real authenticated retirement. A cold tail lookup used
4 point reads, no KV LIST, one R2 GET and no R2 LIST. The byte-identical a841 legacy
reader returned the same correct event5,000,100 using51 R2 LIST pages and one GET.
It did not truncate at50,000: this proof establishes catalog-wide listing work,
not that different failure, native latency or backend capacity. The tracked10,000
index test and301-insertion adversarial cleanup tests cover bounded scale/fault
behavior. Ignored evidence contains the comparative harness, exact source/log
hashes, alarm red/green source and logs, full gate and protected before/after hashes.

The original eight tracked UI dirty files/status and the engine62-line candidate
source/diff hashes match their pre-task values. Shared control/main handoff and
other worktrees remain unmodified. Commit/PR/exact CI readback belongs in the
exclusive dedicated HDD result so source validation is not attributed to an older
head. No production migration, repair, deploy, artifact publication or merge ran.
