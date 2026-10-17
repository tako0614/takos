# Takos GA: retain offloaded events after a terminal segment

Date: 2026-09-30 UTC
Status: source verified / integration pending / live qualification open
Owner: Takos dedicated session
Required for: production_or_release
Grants production mutation authority: false
Repository mutation scope: `takos` only
Base: `00ffa2f44cb9c01c40de2c917ff97d5d593e93a0`

## Gap and acceptance

The source advances the event offload segment after a mid-segment terminal
flush, so later events can occupy a new immutable segment. The next emit derives
the old segment from its event ID and can reset the live index backwards.
`flushR2Segment` then treats that index as already written, returns without a
write, and the caller clears the buffered events. Prove the loss through actual
RunNotifier emits, gzip object writes and the actual offload reader before fixing.

The fix must retain all correlated events after a terminal flush, including
after restoring the existing persisted notifier state. Already committed segment
bytes must remain intact. Segment selection cannot go behind the last successful
flush. Failed object writes must keep their buffer for retry. Reader pagination,
event ordering and cursor filtering must retain the current owning contract.
No fields, keys, schema, authentication, billing or shared contracts are changed.
Only throwaway local test data is written; no existing resource is mutated.

## Source change and regression evidence

Before the fix, real emits 1–200 with a terminal event at 150 wrote only events
1–150 to the gzip archive. Warm continuation and a restored notifier both lost
151–200. The initial regression run had 8 passing existing tests and 2 failing
new tests; raw output is retained at
`tmp/ga-sse-recovery/offload-regression-red.log` in this dedicated worktree.

`handleR2Offload` now normalizes both the live and incoming segment index above
the last successfully flushed index. Normalizing the live index first also keeps
the pending buffer in the existing legacy state `(index=2, lastFlushed=2,
buffer=151..199)` until it can be written under the next key. The known closed
segment remains byte-identical after continuation. Failed puts still leave
their buffer available for retry; the successful-write watermark does not advance.

The notifier test file passes all 13 tests: the original 8 authorization tests
plus warm continuation, actual persisted cold replacement, explicit legacy
state restoration, consecutive terminal events and a failed post-terminal put.
The fixtures use the actual gzip writer/reader and clone values on durable
storage get/put. They assert ordered IDs and payloads 1–200, unchanged closed
segment bytes, reader pages after 150 and 167, and that the injected segment-3
failure actually occurred. The existing authorization fixtures enable no
offload binding unless a new test explicitly supplies one. Independent final
review found no concrete P1/P2 defect in this scoped runtime/test diff.

This prevents future loss and preserves pending legacy buffers; it does not
restore events already cleared by the old implementation. Live archive repair
has not been attempted. Atomic recovery across an object put that succeeds and
a subsequent failed DO state persist is a pre-existing, separately unqualified
boundary. No live R2, deployed DO or production data was used in these proofs.

## Complete gate

The complete `bun run check` succeeded on 2026-09-30 under CI-pinned Bun 1.3.14,
using this dedicated HDD worktree, two Cargo jobs and reduced CPU/I/O priority.
It ran 1,331 Bun tests across 227 files with 7,590 assertions, 20 OpenTofu tests,
96 default Rust wrapper tests and 169 mock-feature wrapper tests, every declared
format/static/type/architecture/compile/Clippy/build phase, and the mandatory
real Worker/SQLite/compiled-process recovery proof. The reviewed engine remained
at pin `c4c3c9f0ffc3956a917b8da38f97671dbd3aea2d` with Rust 1.94.0.
Existing declared lint 112 / TypeScript 98 diagnostics remain; undeclared
diagnostics are zero. Raw output is retained in this worktree at
`tmp/ga-sse-recovery/offload-integrity-check.log`. No new user-facing docs were
changed in this addition. A prior docs build is not evidence for runtime changes.

Hand back this source commit through existing draft Takos PR #126. The new exact
head's CI result must be read back separately; earlier green commits cannot
qualify this diff. Merge, image publication, deploy and real-environment
acceptance remain unperformed.

## Capacity investigation and main-owner proposal

`getRunEventsAfterFromR2` currently lists every segment key before filtering by
the requested cursor. Page/poll work therefore grows with old history. A bounded
local probe of the unchanged reader at base `00ffa2f44` uses native-shaped
prefix/cursor pagination and an actual gzip tail segment. Reading the last 100
events gave these request counts:

| Existing segments | Represented events | List requests | Listed metadata | Body GETs | Returned events |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 100,000 | 1 | 1,000 | 1 | 100 |
| 10,000 | 1,000,000 | 10 | 10,000 | 1 | 100 |
| 50,000 | 5,000,000 | 50 | 50,000 | 1 | 100 |

The bucket exposes no seek-key extension and returns at most 1,000 keys per
page. Old segment bodies are virtual catalog entries; only the tail body is
read. The probe and raw results remain in this worktree at
`tmp/ga-sse-recovery/offload-capacity.{ts,jsonl}`. This measures local call counts,
not backend latency, subscriber load, storage capacity or deployed performance.
The archive integrity fix does not optimize these listings.

The current [Workers R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
lists by prefix, opaque cursor, limit and delimiter; it has no lexical seek-key
option. Adding a `startAfter` option to local/S3/GCS adapters would not establish
that the actual native Worker binding implements it. `runs.last_event_id` is
also not an R2 commit boundary: notifier offload failures are caught and the SQL
update is best effort, so it can lead or lag the actual object writes.

There is currently no qualified history-independent seek for arbitrary sparse
numeric archives with minimum-width-six legacy names. Decimal prefix partitions
can improve some histories but add empty calls per poll and interleave
longer-width keys; a cached end cursor also does not establish cross-write
completeness or numeric-width rollover. Do not ship one of these as full capacity
qualification.

Proposal to the main owner: select an exact object Form/Interface/Binding and
backend that provides a proved ordered range-list operation, or decide a durable
archive index and its failure/recovery authority. This session does not extend
published shared semantics or create a Takos-specific Host branch. Qualification
needs the actual backend's lower-bound/order/pagination/gap/rollover behavior,
followed by subscriber/history load and recovery measurements. The independent
offload data-loss fix can proceed without that contract decision.
