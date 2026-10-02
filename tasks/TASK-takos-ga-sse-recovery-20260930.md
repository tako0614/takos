# Takos GA: durable SSE recovery

Date: 2026-09-30 UTC
Status: source_verified; runtime qualification pending
Owner: Takos dedicated session
Required for: `production_or_release`
Grants mutation authority: false
Repository mutation scope: `takos` only
Worktree: `/root/hdd/takos-dev/worktrees/takos-ga-20260930-1737`
Base: `43b5fe68c7c7e1d09d0ee053d2ff9ebc618f1fc2`
Integrated main: `1da7a7d0e5e3d6a0c552cd29976c0fc9abe9105b`
Verified code commit: `8fb9a25b90c00f7eaa4753d9b646ca6f729ecdd5`

## Scope and ownership

Only this Takos worktree changes. The parent Takoserver session owns shared
contracts and integration; Takosumi, Yurucommu and Yurumeet have other owners.
The original Takos checkout has uncommitted chat presentation, model selector
and tool-label work, which this task does not edit or copy.

The current control context is `takos-control/README.md`, `ARCHITECTURE.md`,
`docs/takoserver/ga-status-20260929.md` (16:00 source/assignment update), and
`tasks/HANDOFF-20260926-codex-daemon-restart.md`. Historical gap lists are not
proof of current implementation or live state.

## Defect and acceptance

Node SSE subscriptions bypass durable SQL/object-store observation when a
process-local notifier is present. Restart or ring eviction can lose replay,
and reconnecting to an already terminal run can leave the stream open forever.

- Read and order replay from the persisted run timeline after the exact cursor.
- Retain prompt notification delivery by using notifier messages as wakeups;
  notification buffers do not replace the persisted timeline.
- Close terminal streams, including when the cursor already covers completion.
- Release subscriptions/timers on completion, error and client disconnect.
- Prove restart replay, cursor handling, live wakeup, failure and cancellation.
- Run focused regressions and the complete owning `bun run check`.

## Integration and remaining dependencies

No common contract, persisted schema, permission, billing or deployment change.
No production deploy, new authorization or destructive cleanup is permitted.
Run only one complete gate here after checking other active builds. Local gate
success is source evidence; full agent execution, Host/Actor/vector/container
interop, runtime-secret delivery and production acceptance remain separate
dependencies owned by the integration session.

## Evidence

- Before the fix, real Hono/SQLite routes with a restarted Node notifier failed
  both completion replay and already-terminal cursor closure (2 failures,
  2 controls passed).
- The targeted suite now passes 15 tests, including a 2,005-event history with
  SQL LIMIT 2001, ordered paging, notification races, slow clients and cleanup.
- The starting checkout's full `bun run check` exited 0: 339 Bun tests and 13
  OpenTofu mock-plan tests passed, plus all declared format/schema/type/static/
  architecture/build phases. This is not the newer main gate or live evidence.
  Log: ignored `tmp/ga-sse-recovery/check.log`. Bun 1.4.2 was used for this run.
- Independent Sol review found no P1 or concrete correctness P2 in the recovery
  patch. Per-subscriber polling capacity remains a separate unresolved GA item.
- The integrated current gate exited 0 under Bun 1.4.0: 1,316 portable Bun tests
  (226 files, 6,359 assertions) and 20 OpenTofu mock-plan tests passed. Source
  formatting, generated migration/release/queue/secret drift, migration safety,
  secret policy, architecture, web build and Worker dry-run build also passed.
  Lint and TypeScript have zero undeclared diagnostics; the existing ledgers
  still declare 112 lint and 98 TypeScript diagnostics. No live apply ran.
  Log: ignored `tmp/ga-sse-recovery/current-main-check.log`.
- Current main's install CTA uses JSX-rendered shell continuations. Its contract
  test expected one raw source line and failed before the final gate. The test
  now joins only that presentation syntax while retaining exact arguments and
  command order; nine focused tests and three argument-removal probes passed.
- Source commits: `e71164fd0` implements recovery, `de7708852` integrates main,
  and `8fb9a25b9` repairs the install contract assertion. Post-merge independent
  review confirmed the portable selection and upstream test command are intact.
- Owning deployment docs now distinguish ordinary module apply, the optional
  disposable bridge and the production entrypoint already implemented in this
  repository. `bun run docs:build` exited 0 after those documentation changes.
  No deploy command or production mutation ran.

The [integration handoff](HANDOFF-takos-ga-20260930.md) records the product journey,
exact source requirements, protected engine/UI results and unresolved evidence.

## Updated owner handoff

Read `/root/hdd/takos-dev/handoffs/takos-ga-owner-20260930.md` and the control
`docs/handoff/product-sessions-20260930/{README,takos}.md` and
`docs/quality/product-maturity-work-20260930.md`. Cached Takos main
`1da7a7d0e5e3d6a0c552cd29976c0fc9abe9105b` has an expanded owner gate and newer
product source. Neither SSE implementation file differed from the starting
checkout. That main was deliberately integrated in this branch before verifying
the current source gate. The original detached UI work remains protected.

The current main was intentionally merged into this branch. Its modern portable
test discovery finds both SSE test files automatically; the `test` command is
kept exactly as main defines it. `test:run-observation` remains a focused command.
Integrated `check:lint` and `check:types` pass with zero undeclared findings
(existing ledgers: 112 lint and 98 TypeScript diagnostics). Bun 1.4.0 is used
for this integrated verification, matching the handoff toolchain.

The inherited agent-engine candidate adds 62 test lines in
`ga-takos-agent-engine-20260930/src/engine/session_engine.rs`; it is a separate,
uncommitted test-only result at engine base `0a1216b`. At that handoff it had not
been copied, committed or given a full gate/consumer qualification by this
session. A later isolated full-gate qualification is now recorded in
[the wrapper ledger](TASK-takos-ga-agent-wrapper-gate-20260930.md); the original
candidate is still uncommitted and is not the image's engine pin.
The inherited diff was read and identified by SHA-256
`83978e18d6df79d7b0632c9bf52748a2ea5e69884771fc514024216cde32f0e1`.
Its previously reported 1/1 focused test is prior worker evidence. Integration
of this library change remains separate.

Node executor events normally rely on the one-second durable poll; only paths
that emit to the SSE notifier wake immediately. Object-store enumeration and
DO reads per subscriber still need real capacity qualification. The tests
prove local SQL/notifier recovery, not live Redis, object-store restoration,
agent-engine consumer execution or production readiness.

## Exact reconnect cursor hardening — 2026-10-02

The route accepted numeric prefixes through `parseInt`: `42junk`, `42.5`,
`42e1` and `+42` silently resumed after event 42, and unsafe integers could lose
precision or suppress all replay. Only complete decimal nonnegative safe
integers now select a cursor. Invalid input retains the existing cursor-zero
fallback and header precedence; zero, leading zeros and the maximum safe
integer remain accepted. Workspace access checks and durable replay are
unchanged. This is an independent Takos source correction, not a fix for native
Container callback transport or per-subscriber capacity.

Real Hono/SQLite route regressions failed 13 cases before the correction
(12 controls passed), then the exact route/stream suites passed 40 tests with
130 assertions under pinned Bun 1.3.14. They cover malformed/unsafe header and
query cursors, decimal boundaries, SQL cursor preservation, header precedence,
restart replay, stream closure and the private Workspace access boundary.
Commands use exact `./` test paths; an earlier green log selected only the
route file and is not counted as both suites. Evidence is ignored
`tmp/ga-sse-cursor-20261002/cursor-{red-v1,green-v1,green-v2}.log`.
Independent source review is GO for the parser, cursor propagation, existing
access boundary and regression coverage. The first local gate stopped at a
new test-only TypeScript readonly-array overload; spreading the expected IDs
preserves the assertion and the corrected project-wide type check passed with
zero undeclared diagnostics (existing debt: 98). That early failed lane also
resolved child Bun to the system 1.4.2 through an incorrect PATH entry, so it
is not pinned complete-gate qualification. The corrected lane pins the Bun
directory for all child commands. Both the failure and corrected type log
remain in this evidence bucket. The corrected complete gate exited 1:
1,721 passed and 3 native timeout failures out of 1,724 tests/262 files
(12,526 assertions, 314.80 seconds). HTTP schema admission passed; notifier,
usage and canonical stale-Run proofs reached their unchanged 75/70-second
limits. Format, lint and types passed; later architecture/Rust/build phases
were not reached. The source freeze remained unchanged throughout the run.
High host I/O pressure was observed, without establishing the timeout cause.
No unchanged-source gate/native retry or deadline relaxation was made.
The earlier `21caddc17` CI success qualifies that tree, not this new correction;
exact-commit CI verification is recorded separately in the integration handoff.
No shared contract, schema, image input, authentication grant, billing or
deployment change is part of this correction.
