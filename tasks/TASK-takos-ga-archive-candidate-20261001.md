# Takos GA: offline Run archive candidate

Date: 2026-10-01 UTC
Owner: dedicated Takos session
Status: local source gate verified; target integration remains open
Source base: 9b2c2fc202530213b9ee62115fc0a6aa8a340e88
Required for: persisted_schema, production_or_release, authority
Mutation scope: Takos source and new local candidate files only

## Purpose and authority

The indexed reader accepts at most 8 MiB compressed/expanded per segment. Older
readers accepted 200 MiB expanded, so a legitimate retained archive can need
offline forward repair. Implement a tool that reads an operator-retained export
and creates a complete, verified Run candidate in a new isolated KV/object-store
namespace. Original KV, gzip, SQL witness, other worktrees and live targets remain
read-only. No apply/upload/deploy, permission or billing operation is implemented.

The candidate may reuse canonical logical keys with different bytes in its NEW
namespace. It must never be applied in place to the source bucket/prefix. Main
owns whole-instance/other-Run closure, target choice, quiescence, late writes, SQL
reconciliation, publication, exact backend qualifications and the live restore
drill. A candidate is not proof that these requirements have been met.

## Implementation and invariants

1. Require a caller-pinned export manifest digest and read only private regular
   files with exact byte counts/digests. Refuse symlinks, hardlinks, path escape,
   duplicate keys, changed files and an existing or source-contained output.
2. Validate the existing outer head/chunk/intent closure and logical state using
   production parsers. Validate known source index authority and accepted
   pending/ring/receipt witnesses. Sparse event IDs are legitimate.
3. Stream strict legacy gzip JSONL, bounded to 256 MiB compressed/200 MiB expanded
   per object. Preserve event ID/type/data/created_at exactly. Never invent IDs or
   promote an above-frontier object without its accepted pending/intent witness.
4. Repack all accepted Run events into canonical candidate keys 1..N, at most
   100 events and 8 MiB compressed/expanded per segment. A single unrepresentable
   event refuses conversion. N <= accepted event count <= source counter.
5. Preserve counter, ring, emit/usage receipts, usage pending/intents/blobs and
   usage object bytes. Archive Run pending once, then clear only its candidate
   pending/intent. Build a ready schema3 root and a production v2 chunk head.
6. Verify the candidate through cold production RunNotifierDO `/archive` and
   current indexed reader, comparing complete event and preserved-state digests.
   Seal its manifest last and return the exact manifest digest. Failure leaves
   an unsealed private candidate, never a successful artifact.
7. Independent review, meaningful large legacy/corruption/file-custody tests,
   complete owner gate, exact commit/PR/CI and dedicated handoff.

## Ownership

archive_offline_converter owns scripts/lib/run-archive-candidate.ts and its test.
Parent owns scripts/run-archive-candidate.ts, its tests, docs, ledger, integration
and final verification. archive_tail_design reviews read-only. One writer per
file; everyone preserves unrelated changes. Heavy gates run one at a time on HDD
with pinned Bun1.3.14, jobs2/nice10/ionice2:7 after checking competing processes.

## Evidence limits

The input digest binds a chosen export, not the live source's completeness or a
distributed snapshot. Opaque SQL witness bytes can be retained without being
interpreted as R2 high-water authority. Missing historical data is not recovered.
The tool must report unsupported/corrupt source states honestly, not discard
accepted data to make a candidate. A runtime-admissible source head/capacity and
an isolated candidate do not prove production quotas, automatic alarms, complete
instance restoration, rollout or reversal. Retain original source copies.

Long Run receipt capacity, usage aggregation above50,000, real owner-sub/mobile
correspondence and the live first-install/Run/recovery journey remain separate.

## Verification — 2026-10-01

Authoritative parent verification uses pinned Bun1.3.14. The worker's earlier
10-test/static run used its default Bun1.4.2 and is not the pinned final gate.
Combined CLI/library tests pass20/20 with125 assertions. Full `bun run check`
passes1,501tests/243files/10,512assertions,20OpenTofu tests/plans, all Rust phases
(default96/mockaggregate169), mandatory actual Worker/fullSQLite/ToolExecutor/
debug-process replacement, and Web/Worker dry-run builds. Native notifier proof
passes20 observations in36.914s. Existing types98/lint111 debt is unchanged;
zero undeclared diagnostics, no new exemptions or weakened deadline/assertion.
Docs build and diff check pass. No owned proof process remains after the gate.

The filesystem proof uses a retained synthetic85-event gzip with10,555,545
compressed bytes and14,010,445 expanded bytes. Current production reader code
with local adapters returns503/repair. Final CLI conversion emits two gzip
bodies6,283,054 and4,272,543 bytes, then cold-verifies every original event field
and event digest. Source files retain their hashes. Final candidate manifest SHA:
4ec46f5f7a839f5de3ba6eb3bd7b3751cc9bf7dcb6779d64ac1c33ec7ec59b68.
Standalone verification with that exact digest succeeds. A prior attempt supplied
the earlier candidate's digest and correctly refused; retain that failure log.
Distinct candidates contain distinct commit heads, so do not reuse an old digest.

Review hardening covers exact source events/usage committed frontier keys,
authenticated partial stage writes, GC retirement against all current reachable
nodes, pending/intent bytes and ring/receipt witnesses, incremental body writes
and lazy readback, output100k object limit, reserved future head capacity, and KV
closure through the final empty page. A short first-page regression forces a
second-page unexpected key so the test does not merely fail on page one.

Ignored evidence: tmp/ga-archive-candidate-20261001/{focused-final.log,
full-check.log,docs-build-final.log,large-candidate-evidence-final.json,
large-final-create.log,large-final-verify-correct-digest.log,protected-after.json}.
Local debug binary SHA904fbb59c30c998e32297fef7a3ccd973af56e320979b6f76d79d2cb629f687c
belongs to the Worker/debug-process proof, not a published image. Exact source
commit/PR/CI and final independent review are recorded in the dedicated HDD result.
