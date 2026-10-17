# Takos GA: accepted Run usage and cumulative local projection

Date: 2026-10-01 UTC
Owner: dedicated Takos session
Source base: 9e4559609deac21b7e2096947c7fdddb99c1dfc8
Status: source reviewed; complete local owner gate passed; committed CI pending
Required for: production_or_release, persisted_schema, authority (local usage integrity)
Mutation scope: Takos source, tests and offline export converter only

Takos is one owner's self-hosted software. These installation-local meter rows
are separate from account-plane commercial billing. No new price, charge,
entitlement, authentication grant, production deployment, existing data deletion
or shared backend contract change is authorized.

The preceding atomic SQL milestone still reads an R2 prefix. That cannot prove
the accepted usage frontier: pending events are absent, PUT may precede its
notifier head, and usage can arrive after a terminal Run. Fixed Run/meter keys
also freeze historical partial aggregates. This change records bounded canonical
meter totals and projection revision in the same notifier head as acceptance,
then projects cumulative totals through a retryable private DO operation.

1. Capture original Takos and owning engine dirty-work hashes before changes.
2. Add a fail-closed logical journal version with bounded totals and durable
   dirty revision. Legacy baselines progress in bounded steps; unknown or corrupt
   history is repair-required, never a claimed empty accepted history.
3. Keep remote object/SQL work outside blockConcurrencyWhile and constructor
   initialization. Arm recovery before accepting dirty work. A lost SQL ACK,
   reset or older revision ACK cannot clear later accepted usage.
4. Project every meter atomically. Preserve first Run/meter row identity, owner,
   scope and month; reconcile local rollups without deleting historical rows.
   Acquire deterministic rollup locks before event writes/SUM. Ordinary meter
   writers acquire existing rollup locks in the same order.
5. Preserve the accepted ledger through isolated offline archive conversion;
   prevent downgrade to a state that drops accepted totals or dirty revision.
6. Test pending/late/restart/failure/old-snapshot and baseline corruption cases,
   real SQL/edge transactions and atomic repair. Independently review, run the
   complete owner gate, commit, verify exact CI and update the dedicated result.

Parent owns parser, converter, integration, ledger and docs. usage_cumulative_sql
owns usage-recorder.ts and its integration tests. A separate DO writer owns the
notifier and bounded ledger module/tests. Contributors do not revert each other.
Use pinned Bun1.3.14, HDD jobs2/nice10/ionice2:7 and check heavy contention.

The retained SQL-token plus raw-meter additive policy does not prove producer
token-source overlap or stable retry identities. Exact common backend atomicity,
remote alarms, real Accounts/client owner subject, published Container image and
production deployment/journey/monitoring/whole-instance restore remain owning
integration or real-environment qualifications.

Reversal: a reader predating the new logical version must reject it. Reverting
source alone is not a safe rollback after new heads have been written. Preserve
exports and use reviewed forward repair/conversion; no in-place downgrade or
existing-row deletion is performed here. Local tests do not authorize deploy.

Evidence is kept in ignored tmp/ga-accepted-usage-20261001/.

The first independent review found three concrete issues: edge.sql rejects
numeric parameters above MAX_SAFE_INTEGER although finite accepted totals may
exceed it; IEEE additions can absorb a positive operand; existing rollup keys
exclude space_id and therefore need a conflict identity guard. Reviewed source
now emits only validated finite nonnegative Number literals for units, rejects
absorbed additions and aborts wrong-space rollup conflicts. Raw/wrapped actual
edge.sql fixtures read back values above the parameter bound. Units retain
JavaScript/SQL REAL arithmetic; this is not a new exact-decimal billing contract.

Run accountId is a Workspace ID. Resolve its actual ownerAccountId (existing
same-ID fallback remains), matching ordinary indexer/execution meter writers.
Keep space_id as the Workspace. A legacy fixed row with the wrong owner requires
explicit forward repair; do not transfer ownership or delete it automatically.

Exact 9e production recorder with actual usage migration SQL reproduces wrong
owner and frozen later token totals:2fail, current projector2pass. The exact old
parser/converter with new tests has11pass/9fail, including schema4 preservation.
Seven intermediate-source numeric/identity regressions are separate controlled
red evidence, not byte-identical old9e. The complete SQL focused suite currently
has34passing tests, including mixed generic/projection with absent/existing
rollups. Its stateful libsql transaction gate cannot prove live PG/edge races.

The new baseline heads shifted an existing test's head-write ordinal. Its fault
hook now decodes the proposed head and counts only logical counter100, preserving
the fault at the second terminal head, ACK/R2 exact bytes and cold closure checks.
The former broad compatibility run has42pass/1fail; the corrected journal suite
has10pass. The configured type gate exposed new test Row-matcher and parser
narrowing errors; these are fixed without debt exemptions. A contributor's broad
default-tsconfig check OOM is not a successful type qualification. Mandatory
configured full owner gate remains required before handoff.

The first complete owner gate passed format, generators, migration checks,
lint111/types98 (zero undeclared diagnostics), then failed portable tests:
1,564pass/1fail out of1,565 in247files/10,901assertions. A newly added oversized
legacy usage body raised the archive reader's integrity class instead of the
usage ledger integrity class, bypassing durable repair. This is controlled
intermediate evidence, not exact9e. Bounded usage reads now translate only that
integrity error into durable usage repair; real remote I/O failures remain
retryable. The final writer files are frozen before rerunning the complete gate.
No assertion or deadline is relaxed. Final DO/unit focused12/82pass (including
oversized), parent focused76/364 and archive compatibility13/324pass.

Independent final review found no new practical blocker in lost SQL ACK,
older-revision ACK/new acceptance, precision rejection, terminal head injection
or parser/converter preservation. Original Takos diff/status and short-worker
engine source/diff four hashes remain unchanged. Exact full gate and committed
CI results follow in the exclusive dedicated result; no partial check is GA.

Final complete local bun run check exited0 at07:30UTC. Pinned Bun1.3.14:
1,565portable tests /247files /10,904assertions,20OpenTofu tests/plans,
Rust check/Clippy/default96/mock aggregate169/build, required actual Worker/
fullSQLite/ToolExecutor/checkpoint/process recovery and Web/Worker dry-run builds.
Types98/lint111 declared debt remains; zero undeclared diagnostics, no added
exemption/quarantine, timeout changes or weakened assertions. Native legacy-KV
proof44.634s/observer200 keeps exact head/R2 witness. Current debug binary SHA
2210b92714e773ad123d7d332f7623cd0b59439de281dfbd5edd08852fe68021.
The real Worker fixture records tool2attempts/1operation/1artifact, model2,
usage24/8/3, lease8/messages4/completed1, checkpoint cleared and4staleRPC409.
Its RUN_NOTIFIER is a local stub; it does not establish Accounts/proxy verifier,
Container/image, queue, SSE or live deployment. The separate native notifier
proof also does not qualify production R2/DO/backend lifecycle.

Current docs build succeeds3.26s and diff check passes. The final15source/docs
file hashes match the frozen full-gate source. Exact committed CI must be read
back separately in the dedicated result; no artifact was published or deployed.
