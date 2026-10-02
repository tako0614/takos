# Takos GA: reject notifier service after failed persisted-state restoration

Date: 2026-09-30 UTC
Status: complete source gate and exact-head CI verified / integration pending
Owner: Takos dedicated session
Required for: production_or_release; security/authority boundary
Grants production mutation authority: false
Repository mutation scope: `takos` only
Base: `bbb92a2afa408f4a4010d77858dac28baa98cec9`

## Accepted-state integrity gap

`NotifierBase` catches a failed persisted-state load and calls `resetState`, then
continues to serve. A cold RunNotifier whose existing `bufferState` read fails
can accept an unrelated terminal event from counter zero and overwrite R2
segment 1, even though earlier events were already acknowledged. Notification
notifiers also lose their restored counter and owner state on that fallback.
A genuinely absent state is a fresh instance; a failed read is not evidence of
absence. The owning runtime must preserve that distinction.

Acceptance: reproduce the overwrite with actual RunNotifier emits and gzip
objects, then reject every entrypoint of an instance whose restoration failed.
Hold incoming requests until restoration completes even in a direct local class
call. A healthy cold instance resumes above its restored counter, including after
a separate failed instance; archived bytes and stored state remain intact on
failure. Preserve the Cloudflare callback rejection and observe rejected local
readiness promises without turning them into a successful fresh state. Remove
the now-unused reset fallback. No persisted fields, authentication grants,
operator secrets or common binding shape are changed.

## Regression and source proof

The actual pre-fix RunNotifier accepted the replacement terminal emit with HTTP
200 and event ID 1 after the injected read failure. The stored state and gzip
object changed, and the prior archive of IDs 1–100 became just `[1]`.
Initial evidence is at `tmp/ga-sse-recovery/restore-failure-red.log`. The final
tests were also run against an isolated archive of base `bbb92a2af`, with a
serialized local concurrency queue: 16 passed / 3 failed, including a direct
held GET, all failed-read entrypoints and actual R2 overwrite. Raw output is
`tmp/ga-sse-recovery/restore-failure-final-tests-red.log`.

The source now retains the original initialization Promise, rethrows the load
error inside the platform callback, and waits for it on fetch, alarm and all
three hibernation callbacks. An observation catch prevents a local unhandled
rejection without converting the original readiness into success. The unused
reset methods were removed. All 19 focused tests pass, including an unchanged
archive after failed restore and a fresh healthy instance resuming at ID 101.
An independent final review found no concrete P1/P2 in this scoped fix.

The first full check found three new test-fixture TypeScript errors. They were
fixed without changing the debt ledger, and the debt-aware type check then passed
with zero undeclared diagnostics. The WebSocket rejection tests now compare the
original failure object and do not replace the global WebSocketPair constructor.
Keep the failed check at
`tmp/ga-sse-recovery/notifier-restore-check-first-typefailure.log`.

A second full check exposed Bun path-filter overmatching: Git selected 227 test
files, but an ignored old-source archive with matching suffixes made Bun execute
405 files, including the deliberate red fixtures. The discovered inventory was
correct; relative child arguments were filters rather than exact file paths.
The runner fix and its child-process regression are tracked separately before
repeating the complete gate. Keep this diagnostic at
`tmp/ga-sse-recovery/notifier-restore-check-pathfilter-failure.log`.

After the exact-path runner fix, the complete gate passed on Bun 1.3.14 with the
old-source archive still present: 1,335 tests / 228 files / 7,699 assertions,
20 OpenTofu tests, wrapper default 96 and mock-LLM 169 tests, compile/Clippy/
executable/web/Worker builds and the actual Worker/SQLite/process recovery proof.
Declared lint 112 and TypeScript 98 debt remain unchanged, with zero undeclared
diagnostics. The gate terminated with exit 0; raw evidence is at
`tmp/ga-sse-recovery/notifier-restore-check.log`. This is source/local proof,
not a published image or live backend qualification.

Commit `f5207eb193d71f28a2fc1895e2a213a725bddf82` passed the complete remote gate
at 2026-09-30 22:01:54 UTC:
https://github.com/tako0614/takos/actions/runs/36782775728 . The exact-head log
confirms the failed-read archive integrity regression and Worker recovery proof
executed. Raw evidence is `tmp/ga-sse-recovery/notifier-restore-ci.log`,
`notifier-restore-ci-readback.json` and `notifier-restore-ci-watch.log` in the same
directory. Later changes require their own gate/CI result.

## Source, platform and remaining recovery boundary

Cloudflare documents that a thrown `blockConcurrencyWhile` callback resets the
DO; swallowing the error defeats that behavior. The existing neutral binding
already returns a Promise, so Takos can retain and await that same readiness on
fetch, alarm and hibernation callbacks without a new shared contract.
Primary source: https://developers.cloudflare.com/durable-objects/api/state/

The distinct R2-put-success / subsequent DO-state-put-failure window remains
open. An offload-only request with a failed final state write should not be
acknowledged on Cloudflare; do not label it an accepted request. An event already
committed to SQL can remain available via the SQL timeline while its R2 copy
regresses. `RunNotifierDO` is declared legacy KV-backed, and writes the ring plus
pending offload buffer into a single `bufferState` value. The documented 128 KiB
value limit and 128-entry multi-put limit must be modeled before qualifying large
payloads or a crash-safe write intent. Primary source:
https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/

The reviewed next design is a bounded DO-owned manifest, chunked payloads and
immutable compressed flush intent committed atomically with ID/dedup before R2.
On replacement, replay exact bytes and fail closed on a different object; bound
pending bytes and reject new work instead of dropping accepted pending entries.
Legacy state conversion and safe rollback fencing require an explicit owning
schema/release design and independent review. They are not implemented by this
restore-read prerequisite. No live DO/R2 failure or production repair is claimed.

An ignored probe now reproduces the distinct storage-write window against
current RunNotifier source SHA-256
`cd5ad58a12f0ac898ed3ced2ea4ed9f2ce0a3535aa801c5533b6012bc0281917`.
IDs 1–99 persist, terminal 100 writes gzip key 1, then an injected final
`bufferState` put rejects. That request is not acknowledged and durable counter
remains 99. A cold instance emitting preferred ID 101 overwrites key 1 with the
stale 1–99 buffer; after terminal 102 the archive is 1–99,101,102. Gzip key 1
shrinks from 671 to 651 bytes. This proves the R2 copy can regress; the fake SQL
stub is not SQL persistence proof and event 100 is not accepted-data loss.

The same probe observes JSON-serialized `bufferState` at 143,778 bytes for a
70 KiB nonterminal ASCII payload and 143,671 bytes for a 140 KiB terminal ASCII
payload. These exceed a modeled 128 KiB budget, but JSON byte counts do not
qualify the native V8 serialization limit. Raw source, command and observations
remain at `tmp/ga-sse-recovery/storage-window-probe.{ts,log}`. Both gaps stay open.
