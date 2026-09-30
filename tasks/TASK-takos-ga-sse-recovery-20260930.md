# Takos GA: durable SSE recovery

Date: 2026-09-30 UTC
Status: active
Owner: Takos dedicated session
Required for: `production_or_release`
Grants mutation authority: false
Repository mutation scope: `takos` only
Worktree: `/root/hdd/takos-dev/worktrees/takos-ga-20260930-1737`
Base: `43b5fe68c7c7e1d09d0ee053d2ff9ebc618f1fc2`

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

## Updated owner handoff

Read `/root/hdd/takos-dev/handoffs/takos-ga-owner-20260930.md` and the control
`docs/handoff/product-sessions-20260930/{README,takos}.md` and
`docs/quality/product-maturity-work-20260930.md`. Cached Takos main
`1da7a7d0e5e3d6a0c552cd29976c0fc9abe9105b` has an expanded owner gate and newer
product source. Neither SSE implementation file differs from the starting
checkout. Integrate that main deliberately in this branch before calling the
current source gate verified. Preserve the original detached UI work.

The current main was intentionally merged into this branch. Its modern portable
test discovery finds both SSE test files automatically; the `test` command is
kept exactly as main defines it. `test:run-observation` remains a focused command.
Integrated `check:lint` and `check:types` pass with zero undeclared findings
(existing ledgers: 112 lint and 98 TypeScript diagnostics). Bun 1.4.0 is used
for this integrated verification, matching the handoff toolchain.

The inherited agent-engine candidate adds 62 test lines in
`ga-takos-agent-engine-20260930/src/engine/session_engine.rs`; it is a separate,
uncommitted test-only result at engine base `0a1216b`. It has not been copied,
committed or given a full gate/consumer qualification by this session.

Node executor events normally rely on the one-second durable poll; only paths
that emit to the SSE notifier wake immediately. Object-store enumeration and
DO reads per subscriber still need real capacity qualification. The tests
prove local SQL/notifier recovery, not live Redis, object-store restoration,
agent-engine consumer execution or production readiness.
