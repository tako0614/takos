# Takos GA: durable notifier journal

Owner: dedicated Takos session, branch dev/takos-ga-20260930-1737.
Status: source reviewed and complete local gate passed; exact-commit CI/integration pending.

## Scope and order

This task changes Takos-private persisted notifier state and recovery behavior in
this worktree only. It does not change a shared Form, Interface, binding contract,
account permission, billing, or deployed resource. Main owns shared backend
qualification and final integration. Other worktrees and existing user data are
preserved. No deployment or artifact publication is authorized by this task.

1. Read current main handoff and original dirty tree; preserve their work.
2. Independently review the journal design and rollback boundary.
3. Implement chunked state, a single commit head, exact-byte flush intents,
   recovery, retained pending entries, and capacity backpressure.
4. Demonstrate failures against the prior source and verify current source,
   native local storage, complete repository gate, and independent review.
5. Return a verified commit/PR and distinguish remote/live dependencies.

## Invariants

The single `bufferState` v2 head is the commit point. Immutable, bounded chunks
are staged before it. All referenced bytes and digests are validated before
state installation. A failed head write is ambiguous: reload authoritative state
before another operation, and refuse operations if that reload also fails.
Acknowledgement, broadcasting, and SQL cursor projection follow the head commit.

Freeze gzip exactly once in durable chunks, and commit the flush intent before
R2 side effects. Recovery uses those bytes. Equal existing bytes permit completion;
absence permits writing and authoritative readback; differing bytes halt without
overwrite. Finalization merges the current head and removes only its own intent.
Recovery alarms are armed before a head containing pending work is committed.

The aggregate byte and descriptor budgets apply before admitting new work. Never
drop accepted pending entries to make room. Stable producer receipts distinguish
retries from different events; equal usage payloads are not retry identities.
Garbage collection only removes internal chunks unreachable from the committed
head, under notifier serialization, after verifying its complete live closure.
For an absent or strict legacy head, it removes only failed-stage v2 copies.
Stage-time alarms and bounded re-armed scans permit cleanup without another emit.

## Compatibility and reversal

Valid historical/unversioned and schema1 snapshots remain readable. Conversion
stages complete chunks before replacing the legacy head. The guard in 6066a1a5c
rejects schema2, so rollback to that source refuses writes rather than treating a
new journal as empty. A deployed and retained guard-aware artifact has not been
proven. Rolling back below the guard requires offline restoration or forward
repair. There is no destructive production conversion in this task.

## Authority and evidence

Independent design review: notifier_durability_design. Parent owns generic chunk
storage/base/notification integration; notifier_journal_run owns run state/pump;
offload_regression owns new regression tests. One writer per source file.

Cloudflare references checked on 2026-10-01:

- https://developers.cloudflare.com/durable-objects/api/legacy-kv-storage-api/
- https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- https://developers.cloudflare.com/r2/reference/consistency/

Single-key durability, authoritative object reads, actual quotas, recovery alarm
delivery, and performance still require exact target/backend qualification. Local
test doubles cannot establish remote atomicity or deployed lifecycle behavior.

## Implemented and independently reviewed

Run v2 retains every admitted pending event and receipt. Up to one immutable intent
per event/usage stream freezes its exact gzip bytes. Legacy pending frontiers alone
can adopt semantically identical existing gzip, and the adopted actual bytes are
staged and committed under the same serialization as chunk cleanup before removal
of pending entries. New intents require exact raw-byte identity. All remote calls
are bounded at five seconds and run outside blockConcurrencyWhile; a timed-out
call may finish late with the same bytes, but cannot finalize an unobserved result.
Conditional create is followed by exact readback. SQL last_event_id only follows a
durable head and advances monotonically; it is not an archive high-water mark.

Notification receipts cover its 100-event replay horizon, keyed first by actual
notification_id. SQL inbox rows remain the durable canonical identity. A retired
refresh hint can get a new cursor; arbitrary delayed exactly-once hint delivery is
not claimed. Fixed-ID SQL retries re-emit the hint, with response rejection checked.
Receipt payload witnesses and membership in the replay ring are validated on load.
This lifetime bound avoids permanently filling the single owner's notification DO.

Capacity is eight MiB aggregate snapshot plus live blobs and 128 descriptors, with
64 KiB byte chunks. Admission rejects before assigning an event ID, including usage
request retry identity. No accepted pending data is dropped for capacity. A very
long Run can still exhaust receipt capacity; production scaling/performance remains
unqualified. The existing usage producer must supply the optional stable request ID
to gain retry deduplication; equal payloads without identity remain distinct usage.

Independent review identified and resolved WS-bind reload races, unclosed blob
heads, notification receipt saturation/identity precedence, v2 pending without Run
identity, and post-head cleanup deleting old repair copies after live corruption.
The final source pass found no material remaining P1/P2. Legacy adoption staging
was additionally moved inside serialization to fence cleanup.

## Current local evidence

- Focused final source tests: 104/104 across nine files, 2,151 Bun assertions.
  This covers real libsql inbox singleton through ambiguous commit/cold retry and
  retired receipt, journal head failure before/after commit, R2-success/head-failure,
  ambiguous R2 put, concurrent later emit, exact gzip conflict/legacy adoption,
  failed-stage idle alarm cleanup, missing/corrupt chunks, capacity before ID
  assignment, malformed v2 pending, receipts and producer/usage response handling.
- Type gate passes with zero undeclared diagnostics; existing debt remains 98.
  One notification-service lint warning was removed; declared lint debt decreases
  from 112 to 111 without adding exemptions. Source format passes.
- Canonical architecture docs build passed. New architecture entry reiterates the
  personal single-owner product premise and distinguishes SQL inbox from hints.
- Native proof and complete gate are recorded below after completion. Earlier
  fff1ff922 CI success does not validate this new journal source.

## Main-owned qualification proposal

Qualify one exact storage/object/Actor backend rather than inferring guarantees
from a compatible method shape: single-key head durability, authoritative reads,
conditional-create no-overwrite, cold restart and alarm delivery, actual value and
aggregate quotas, retained guard-aware artifact and restore. Current Takos-local
S3/GCS and in-memory put adapters do not propagate/evaluate onlyIf. Their source
is known not to provide that conditional-create guarantee; local ordinary archive
mock tests cannot substitute for it. No shared binding/Form change is made here.
The native proof qualifies local workerd R2 conditional creation only; neither
Cloudflare remote behavior nor these other adapters are proven by that result.

No actual target deploy, billing, new authentication grants, remote data conversion,
image publication, other-worktree modification or merge occurred in this task.

## Complete local gate — 2026-10-01 01:22 UTC

`bun run check` exited 0 on Bun 1.3.14, from this HDD worktree with the owning
pinned engine mirror, CARGO_BUILD_JOBS=2 and RUST_TEST_THREADS=2, nice10/ionice2:7.
No test/deadline/phase was skipped or weakened. Source format, all generated
consistency/safety/static/type checks, 1,438 portable tests / 236 files / 9,017
assertions, all 20 OpenTofu tests/plans, architecture check, Rust check/Clippy/
96 default tests / aggregate mock-feature169 / build, mandatory actual
Worker+full SQLite migrations+ToolExecutor+debug-process replacement, Web build
and Worker dry-run build all pass. Native journal/guard test passes in34.16s with
18 observations and owned-process cleanup. Debug replacement preserves one
artifact/operation over two tool attempts, lease8, four messages, usage24/8/3,
and all four stale RPC409s. Its notifier/proxy remain local fixtures; no live
Accounts/queue/image/SSE/deploy is inferred.

Logs: tmp/ga-notifier-journal/full-check.log, focused-final.log, docs-build.log,
baseline-red-final.log. The optional old-source command exits0 only when the
expected bad witness is reproduced: old fff1ff922 first returns599 after actual
R2 success plus injected head failure, true cold replacement then returns200/
eventId1 and overwrites the same gzip key. Hashes/instance IDs are printed.
This is an expected-bad reproduction, not a passing durability test on old code.
Current native cold retry preserves exact gzip and retires its durable intent;
the competing native R2 put's onlyIf returnsnull, leaves the competing gzip
unchanged and retains pending through eviction. Fault controls live in test-only
local R2/DO keys, and automatic alarms for armed probes are postponed beyond the
proof deadline; explicit production alarm invocation is proven, remote automatic
alarm delivery is not. Local KV quota acceptance remains explicitly unqualified.

Previous fff1ff922 local composite timeout/CI success are historical evidence;
they neither invalidate this successful local rerun nor validate the new journal.
The exact new code commit/CI and artifact source/log digests are returned in the
exclusive dedicated result handoff after commit/push/readback.
