# Takos GA: notifier state validation before journal migration

Date: 2026-09-30 UTC
Status: source_reviewed / deployment and integration pending
Owner: Takos dedicated session
Required for: persisted_schema, production_or_release
Grants production mutation authority: false
Repository mutation scope: takos only
Source base: 3b79815f96b986eea138534f337c9580f49ab2d2

## Failure and acceptance

A rejected storage read now stops initialization, but a successful read of present
null/falsy/malformed data was still treated as absent or installed without shape
checks. It could reset the sequence or let unknown future state be overwritten.
Both RunNotifier and NotificationNotifier must install the whole validated inline
snapshot before rebuilding sockets. Only undefined means no key. Every fetch,
alarm and hibernation callback retains the original initialization rejection.
No recovery code guesses owners, repairs counters or discards accepted entries.

The guard accepts the historical unversioned shape and schemaVersion 1 only.
Version 1 remains inline, with optional legacy run/usage buffers and indices
normalized only in memory. It validates safe counters, ordered replay/pending IDs,
ring size, payload fields, run/user identity shape, segment metadata, usage and
dedup pairs. Unknown versions or fields fail closed without returning stored
payloads in errors. Normal writes declare schemaVersion 1; there is no chunk
conversion, old-row deletion, storage backend migration or deploy in this task.
The known legacy closed-index 2 / pending IDs 151–199 state remains admissible.
Its existing synthetic timestamp fixture now uses the production ISO shape;
archive-content, counter and cursor assertions remain unchanged.

Every producer must also preserve valid state: unsafe preferred IDs and exhausted
safe counters stop before allocation, /usage validates the same run identity and
never changes it on an invalid request. This is instance data consistency, not
upstream authentication permission or billing admission.

## Why a guard comes before the durable write redesign

Independent design review found the original binary cannot be a safe rollback
from a new chunked format: /usage can write after blindly loading an unfamiliar
snapshot. A guard-aware artifact must be qualified and retained as the minimum
fail-closed rollback boundary before conversion. This source candidate alone does
not establish that a deployed guard exists. Rolling back below that artifact after
conversion requires offline state restoration or forward repair, not a blind retry.

Next durable design keeps the full GA objective:

1. Stage bounded immutable payload chunks, then commit a versioned head containing
   the event ID and stable producer dedup receipt before ACK/broadcast.
2. Freeze exact gzip bytes and durably point to an immutable flush intent before
   R2 side effects. Recovery reuses those bytes: an equal existing object can be
   finalized, an absent object can be written and verified, and different bytes
   stop without overwrite. Only verified flush completion advances the watermark.
3. Bound total pending bytes and reject new work before ID allocation when full.
   Accepted pending run/usage events are retained; the oldest-entry drop is removed.
4. Convert valid legacy snapshots through staged chunks and an atomic head/fence
   commit. No unsupported provider transaction is inferred from a TypeScript type.

Cloudflare documents atomic multi-key storage methods, a 128-pair put limit and
128 KiB serialized values for legacy KV:
https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/ .
The neutral binding declares put(entries), but the current local SessionMemoryStorage
and notifier fakes loop over entries; they do not prove backend durability/atomicity.
An alternative single-head commit avoids relying on multi-key atomicity, but needs
an explicit manifest, orphan/chunk and dedup lifetime design before implementation.

R2 documents strong read-after-write and last-writer-wins:
https://developers.cloudflare.com/r2/reference/consistency/ .
Use raw bytes/digest, not the local in-memory ETag (key+length can collide).
Conditional no-overwrite semantics are not qualified across current adapters.
A sole writer and rollback fence remain required. Emit currently holds
blockConcurrencyWhile across external I/O; the native 30-second limit must be
accounted for by the journal/recovery scheduler rather than hidden with retries.

## Verification and remaining evidence

Map-backed tests exercise actual notifier classes, not a copied parser. They cover
corrupt and future state on every entrypoint, zero storage/SQL/R2/socket effects,
existing gzip archive bytes, valid legacy/default fields, schemaVersion 1 cold
replacement and the pending legacy buffer. An isolated native workerd proof is
being implemented with installed Miniflare and useSQLite:false; its test-only
seeding/inspection endpoints are not product routes. Native fixture evidence and
complete gate will be recorded after execution.

R2-put-success/state-put-failure, chunking/value budgets, durable retry identity,
usage idempotency, actual queue/subscriber capacity and remote backend lifecycle
remain open. Most event producers have stable event_id but no dedup_key, and the
usage client has no stable request identity; those product-owned retry contracts
must be decided with the journal, not implicitly promised by this parser.
No image/release publication, Accounts grants, shared contracts or other worktrees
were changed. Production and Host qualification remain integration work.

## Native regression evidence

The isolated installed Miniflare/workerd proof explicitly uses legacy KV
(useSQLite:false) and local R2. Baseline source is pinned to 3b79815. It accepted
future-v2, present null and false, changing native KV and overwriting the original
100-event gzip archive (641 bytes became 120/117). Notification future-v2 was also
overwritten. Raw observed statuses and hashes precede the expected-bad assertions
in ignored tmp/notifier-state-baseline-red.log; this mode exits 0 on a reproduced
defect, not on guard success.

Current guard proves 14 scenarios: both notifiers reject future/null/false/zero/
empty/malformed snapshots across HTTP, alarms and hibernation callbacks with KV
unchanged; run archive raw gzip bytes remain unchanged. Valid historical state
advances counter100 to101, persists schema1, then actual native eviction changes
the instance ID and retains counter/dedup/archive. Raw local evidence is
tmp/notifier-state-native-green.log. Native proof has no SQL binding; best-effort
last_event_id warnings do not qualify SQL persistence.

Focused notifier classes pass 72 tests / 2,021 assertions; the isolated native
test passes 24 assertions. Its process, stdout and stderr lifecycle share one
deadline; cleanup is bounded, checks the owned process group and rejects success
with a live descendant. No proof processes or private fixture directories remain.
No native quota or multi-key atomicity probe was performed. Complete source gate
and exact committed CI are recorded in the dedicated integration result.

Local complete-gate attempt reached static/type, 1,409 portable tests, 20 OpenTofu
tests and all Rust compile/Clippy/default+mock-feature phases. Mandatory debug
Worker recovery then exceeded its unchanged 150-second full-SQLite migration
deadline. The proof process was supervised and the failed context/log retained.
The separate owner-fenced OCI recovery on the same source completed successfully.
Do not report the local composite gate as green; exact committed CI readback is
recorded separately in PR126 and the dedicated integration result.
