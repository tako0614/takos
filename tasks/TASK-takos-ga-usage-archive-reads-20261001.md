# Takos GA: bounded usage archive body reads

Date: 2026-10-01 UTC
Owner: dedicated Takos session
Status: scoped source reviewed and complete local gate passed; exact CI pending
Source base: 6430d9ba4de334de162192a49febee14e3a9aaa2
Required for: production_or_release
Repository mutation scope: takos only

## Boundary and order

The existing usage archive reader fetches and decompresses every segment before
applying its event limit. Fix this product-owned read path without introducing a
usage producer, pricing, charging, authorization, persisted schema or shared
binding change. The sole instance owner remains separate from external share
recipients and communication participants. No deploy, image publication, merge,
new client grants or data deletion is authorized by this task.

1. Re-read the main handoff, control product status and original dirty checkout;
   preserve unrelated work and all other worktrees.
2. Reproduce the eager-reader failure against the exact prior production source.
3. Read sorted segment bodies sequentially and stop at the requested event cap.
4. Verify required-prefix errors, missing/empty segments, pagination and limits;
   review and run the complete repository gate without skipping phases.
5. Commit and return exact local/CI evidence with residual dependencies.

## Invariants and remaining capacity work

Keep the existing global lexical key order and JSONL event interpretation. A
missing or empty segment permits reading later segments. A required GET or gzip
decode failure rejects the read. Objects beyond the event cap are not fetched or
decoded. Normalize NaN to the default cap; preserve ordinary clamp and fractional
comparison behavior. A truncated page must provide a nonempty progressing cursor;
reject repeated cursors instead of looping forever.

All keys are still listed and sorted before reading bodies. This change does not
bound catalog listing, prove remote performance, resolve six-digit lexical key
rollover or qualify very long Runs. The Run history archive has the same separate
listing issue. A durable, authenticated archive index and its migration/rollback
boundary are being reviewed independently; no new index contract is introduced
by this task.

The usage emit helper currently has no production call sites in Takos. Its
optional request ID only deduplicates identified retries. Equal usage without an
ID remains distinct. Do not invent a billing/usage producer to claim end-to-end
retry qualification. Any actual producer must supply its durable record identity.
The existing run-usage RPC does call recordRunUsageBatch, which requests at most
50,000 raw records and falls back to SQL token totals after an archive error.
Neither that aggregation cap nor its fallback policy changes here; completeness
above that cap remains open.

## Evidence and ownership

usage_archive_reads owns only usage-events.ts and its new test file. Parent owns
review, this ledger, complete gate and integration handoff. Both preserve other
contributors' changes. Evidence is retained under ignored
tmp/ga-usage-archive-20261001/; exact source hashes and results are recorded after
the final review. Other worktrees, real backend lifecycle, published artifacts and
single-owner browser/mobile subject correspondence remain outside this proof.

## Scoped review and regression evidence

Independent Sol review found no material P1/P2 in this reader change. The final
six tests exercise one active GET/body read, prefix ordering across reversed
multi-page catalogs, missing/empty segments, required-prefix failure, later bad
gzip exclusion, default/NaN/lower/upper/fractional limits and invalid pagination.
Focused result: six pass, zero fail, 20 assertions. Types remain 98 declared and
lint 111 declared, both with zero undeclared diagnostics; no exemptions added.

The final test is copied byte-for-byte beside the exact 6430d9ba production
source in an ignored baseline tree. Relative imports are unchanged; only shared
dependencies are symlinked to the real source. SHA-256 of the old reader is
c49e97c3e12c33b1d74f498bed44fdebb2e4bdb71f830c8b112fc10c04bca727.
The selected eager-read/NaN tests fail on that source. This is expected old-source
RED, not a current-source success. A separate direct production-source witness
with one valid 10,001-record gzip shows old NaN returns 10,001, while the fixed
reader returns exactly 10,000 and the correct boundary record. It does not depend
on a later malformed object to demonstrate that cap.

Logs and source/test hashes: baseline-manifest.json,
final-test-old-source-red.log and nan-cap-proof.log under the ignored proof dir.
Complete gate and exact committed CI are recorded after completion below.

## Complete local gate — 2026-10-01 01:51 UTC

bun run check exited zero with pinned Bun 1.3.14, the owning engine mirror,
CARGO_BUILD_JOBS=2, RUST_TEST_THREADS=2 and nice10/ionice2:7 on this HDD tree.
All format, consistency, migration safety, lint, type, secret-policy and
architecture phases pass; 1,444 portable tests across 237 files with 9,037
assertions, all 20 OpenTofu tests/plans, Rust check/Clippy/default96/mock169/build,
mandatory real Worker/full SQLite/ToolExecutor/debug-process replacement and
Web/Worker dry-run builds pass. No phase, assertion or timeout was weakened.
The native local notifier test also passes; its remote qualification limits from
the journal ledger continue to apply. No owned proof process remains.

The debug replacement observes two tool attempts, one operation/artifact,
lease8, four durable messages, usage24/8/3 and four stale RPC409s. Current debug
binary SHA-256 is
1c6c7528c073b51dad23b45da4d38da8303ed9811ce031bd631513105efc8a06.
This is a local executable witness, not a published Container image identity.
The gate log is full-check.log in the ignored proof dir. Earlier 6430d9ba CI
success validates the prior source only; it is not substituted for this commit's
new CI readback.

## Reversal

This change introduces no persistent conversion. Reverting the reader restores
the prior eager-fetch behavior, including its capacity cost. No data restoration
is needed. Deployment remains an operator action, not authorized by a green gate.
