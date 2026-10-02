# Takos GA: required quality process completion

Date: 2026-10-01 UTC
Owner: dedicated Takos session
Source base: 1c33fc965dd896969341457e2ec9b37ddac4010e
Status: source reviewed; full local gate passed; exact committed CI pending
Required for: production_or_release (required gate integrity)
Mutation scope: Takos quality scripts, regression tests and owning docs only

The required TypeScript and lint gates await child completion but discard the
exit status. A compiler crash with no TypeScript diagnostic can report green;
a linter's valid empty JSON with abnormal completion can also report green.
The previous contributor's broad-tsconfig OOM is not a successful qualification.
The configured complete owner gate did pass and is retained as separate evidence.

The present nonzero ledgers already reject an entirely absent report. The direct
current risk is matching declared findings followed by abnormal termination, or
the zero-debt web program aborting after the core program reports its debt.
Empty-ledger CLI cases are distinct controlled reproductions. Final proofs cover
both matched debt and diagnostic-free per-program failure; no ledger is weakened.

1. Retain original Takos and owning engine dirty-work hashes; edit only this tree.
2. Validate compiler/linter completion, signals and normal finding exit statuses.
   Preserve the existing declared-debt countdown; no added exemption or filtering.
3. Preserve fatal diagnostics. Refuse malformed lint report shape rather than
   treating absent or invalid diagnostics as a clean report.
4. Use controlled fresh CLI fixtures for diagnostic-free failure, signal, abnormal
   exit after findings, declared-debt compatibility and clean completion. Reproduce
   false green with exact base source; do not intentionally exhaust resources.
5. Independently review, run the full owner gate, commit and verify exact CI.
   Update the authorized exclusive result file with source/live distinctions.

quality_process_gate_fix owns check-types.ts, check-lint.ts and their new process
tests/helper. Parent owns this ledger and final integration. Other agents are
read-only on long Run receipts and terminal usage recovery. Do not revert others.
Pinned Bun1.3.14; HDD jobs2/nice10/ionice2:7; avoid other owners' heavy builds.

No source admission, private Workspace, external participant, authentication
grant, price, charge, production target, shared contract, schema or existing data
is changed. This is not a new GA definition. The active goal still includes
Run/usage/recovery, long receipt capacity, real owner-client correspondence,
backend qualification, published artifacts and live user journey/restore/monitor.

Reversal: restore the reviewed quality script source. No durable data changes.
No deploy/image publication/merge/new authority is performed or authorized.
Evidence: ignored tmp/ga-quality-process-20261001/.

Initial focused10tests/59assertions pass. The pinned installed tools were measured:
TypeScript5.9.3 normal TS2322 exits2 with stdout diagnostics and empty stderr;
oxlint1.30.0 under --deny-warnings exits1 with JSON stdout and empty stderr.
Controlled CLI fixtures use exact1c33 gate/quality-ledger source snapshots, with
all5source/ledger bytes equal to their committed blobs. Matched synthetic debt
followed by core-complete/web-exit137 and lint-exit137 returns old0/current1.
This is simulated fatal completion, not an actual OOM qualification.

Independent review found malformed lint labels/locations could pass matching
per-file debt; supplied label/span/positive integer locations are now checked.
A second finding is unknown TypeScript stdout with matched debt and normal
exit2. The installed nonpretty formatter permits file-backed headers and
nested two-space continuations; final validation/tests are being added.

The frozen intermediate complete owner gate passed1,575portable tests/248files/
10,963assertions,20OpenTofu,allRust/required real Worker recovery/builds.
It predates the stdout review fix and is retained as intermediate evidence,
not final source qualification. Docs build3.59s passes. Final complete gate and
exact committed CI remain required after source freeze and final review.

Read-only runtime investigation also confirmed SQL terminal usage can remain
unprojected when notifier emit fails before acceptance. Reusing search-index
success is insufficient: availability/eligibility/DLQ are separate from usage.
Next runtime fix needs a dedicated durable terminal usage outbox, atomically
written with terminal CAS, plus independent claim/retry/recovery/readback.
Long Run receipts currently exhaust the bounded inline snapshot; scalable
authenticated receipt storage with migration/converter/GC remains separate
unimplemented work. No source/listing success here closes those requirements.

Final stdout validation and canonical multiline compatibility regressions pass:
12tests/65assertions. Final independent bounded review reports no remaining
practical blocker. Fixed tool invocation/output contracts are evidence, not an
independent oracle against an intentionally lying compiler. Exact-base matched
synthetic debt plus unknown stdout returns old0/current1; canonical nested TS2322
returns current0. Snapshot/hash manifests verify; no resource exhaustion occurs.

Final frozen complete bun run check exited0 at08:14UTC. Bun1.3.14, HDD jobs2/
nice10/ionice2:7 and owning engine mirror:1,577portable tests/248files/
10,969assertions,20OpenTofu,allRust check/Clippy/default96/mock aggregate169/build,
required actual Worker/fullSQLite/ToolExecutor/checkpoint/process replacement,
Web/Worker dry-run builds. types98/lint111 remain exact with undeclared0.
Native legacy-KV proof42.656s/observer200, current docs build3.59s. No new
exemption/quarantine/timeout/assertion reduction. Frozen5source/docs hashes match.
Commit/CI/compiled binary identities and protected4hashes are read back in the
exclusive dedicated result. No published artifact/deployment is qualified.
