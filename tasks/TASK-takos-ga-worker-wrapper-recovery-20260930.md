# Takos GA: SQL-backed Worker and wrapper process recovery

Date: 2026-09-30 UTC
Status: source, local integration and CI verified / integration pending
Owner: Takos dedicated session
Required for: production_or_release (required product-gate expansion)
Grants production mutation authority: false
Repository mutation scope: `takos` only
Base: `fe0ee3fd999340423ada22c4552d06420102dc93`

## Gap and acceptance

The wrapper's replacement tests use a fake Worker ledger. They do not establish
that the real Worker handler, production tool executor, actual operation ledger
and atomic completion compose correctly with a restarted Rust process.

Add a mandatory proof after the pinned wrapper gate builds its default-feature
executable. Use the actual SQL adapter with the full current migration set in
a fresh file under this worktree's ignored `tmp`. Seed only a throwaway user,
workspace owner witness, thread, message and leased Run. All wrapper RPC calls
reach the actual `dispatchControlRpc` handlers; catalog, tool executor,
`create_artifact` side effect, checkpoint and completion are not replaced.

The local model is canned, the notifier is a no-op sink, and the bridge maps a
throwaway token to lease identity.
It substitutes only model/provider and proxy-token verification boundaries,
not the SQL/Worker logic under test. It makes no Accounts or provider request.
The throwaway Rust process explicitly admits only `create_artifact`; ordinary
executor-host configuration remains unchanged. This is a fixture configuration,
not a grant to any existing user or environment.

1. Let the real tool operation commit; withhold its HTTP acknowledgement.
2. Inspect the real saved `execute_tools` checkpoint and completed operation.
3. Kill/reap only the proof's own old wrapper process, switch the Run's service
   and lease, then start a fresh wrapper process.
4. Require the same operation key and loop identity, two tool RPC attempts,
   one artifact, one completed operation, correlated transcript, cumulative
   usage and exactly one new-lease atomic completion.
5. Old-lease checkpoint/tool/completion attempts must be rejected without mutation.
6. Require bounded startup, RPC, process lifetime and cleanup; never skip a
   missing binary or failed proof. Preserve failure diagnostics and avoid
   unbounded child output or accidental use of operator provider credentials.

## Remaining evidence

This is actual Worker-handler/SQL plus executable-process integration. It does
not establish production proxy authentication, notifier/SSE delivery, public browser login, queue
dispatch, Container image/restart, remote SQL/R2/Redis, Host Form/Binding admission,
or deployed user behavior. Those GA requirements remain until independently
qualified. No deploy, billing, new authentication rights, shared-contract change
or mutation/deletion of existing resources is included.

## Local integration evidence

The focused proof passed against the default-feature executable built from
the exact engine pin `c4c3c9f0ffc3956a917b8da38f97671dbd3aea2d` and current
wrapper source. It copies the executable into its unique proof context, hashes
that copy and launches the same bytes for both processes. The focused executable
SHA-256 was `0c06710a590eccf9269ab76b56b40715ceea917c85e1e162e62dbbc67cc34985`;
subsequent gate builds have their own printed digest.

The real SQL state retained the pending `execute_tools` checkpoint and engine
loop identity. Two successful tool RPC attempts used the same operation key,
while SQL held one artifact and one completed operation. Two model calls
produced cumulative input/output/cache usage of 24/8/3. Lease 8 completed with
four durable messages, one completed event and the checkpoint cleared. Old
lease heartbeat, checkpoint-save, tool-execute and complete-run each returned
409 without changing the Run, artifacts, operation, messages or events.

Independent review found and resolved acknowledgement ordering, executable
provenance, ignored cleanup errors and late child registration on watchdog
expiry. The proof has a 300-second overall watchdog and bounded startup/RPC/reap
phases; the gate adds a 360-second POSIX process-group limit. A child is registered
before its first asynchronous wait, and cleanup failure fails the proof and
retains diagnostics. Only successful, closed and reaped proof contexts are removed.
Cargo commands do not inherit this proof-specific process limit.

The complete product `bun run check` passed under CI-pinned Bun 1.3.14:
1,326 Bun tests / 6,751 assertions / 227 files, 20 OpenTofu tests, 96 default
wrapper tests and 169 mock-LLM tests, plus format/static/type/architecture,
Rust fmt/compile/Clippy and production executable/web/Worker builds. The required
real Worker/process proof also passed inside this complete gate. Its executable
SHA-256 was `a7670d6d9c09a35588338ca7029cdaad186aa694ad78e4a60f69f799191c8ce6`.
Existing debt stayed at 112 lint / 98 TypeScript findings, with zero undeclared
findings. Raw log: ignored `tmp/ga-sse-recovery/worker-recovery-check.log`.
`bun run docs:build` also passed; raw log is ignored
`tmp/ga-sse-recovery/worker-recovery-docs-build.log`.

Independent final Sol review found no remaining concrete P1/P2. Focused gate
tests passed 10/10 with 392 assertions, including a timed-out leader and its
recorded descendant, a successful leader leaving a descendant, and explicit
Windows rejection before spawn. Windows process-tree qualification is not
provided; the mandatory proof fails closed there.

Owning Takos code commit: `4159b8895c58e6097ecfc221cf1592c459334800`.
Draft [Takos PR #126](https://github.com/tako0614/takos/pull/126).
Its exact-commit complete [CI run](https://github.com/tako0614/takos/actions/runs/36772813753)
succeeded at 2026-09-30 20:31:13 UTC, including the required real Worker/process
proof. Raw remote log and exact-head readback are retained in ignored
`tmp/ga-sse-recovery/worker-recovery-ci.log` and
`tmp/ga-sse-recovery/worker-recovery-ci-readback.json`. CI qualifies these source bytes; it is not
Container publication, release or deploy evidence. Merge remains with integration.

## Subsequent integration-test lifetime correction

The documentation-only head `b1939ccc953428a4d53187f509fdc2da868723a4` failed
[CI](https://github.com/tako0614/takos/actions/runs/36773414829) solely because the
existing real SessionDO env-builder integration exceeded Bun's default
5-second test limit: the whole test took 9,198 ms. It includes fresh SQLite
migrations, platform setup and disposal; those phases were not separately timed.
The same test passed in 1,259 ms in the preceding code CI and 644 ms locally.
The log reports a timeout, with no failed OIDC-state or alarm-cleanup assertion.
CI I/O variance is a plausible inference, not a measured performance root cause.

`session-env-builder.test.ts` now gives this integration an explicit bounded
30-second lifetime. Every existing state and timer-disposal assertion remains;
no runtime, migration, SessionDO or identity behavior changes. This mitigates
the integration test's default-limit failure; it is not a runtime performance fix.
The focused test passed under Bun 1.3.14 (1 test / 3 assertions). The complete
`bun run check` passed again after this correction, with the same 1,326 Bun /
20 OpenTofu / 96 default Rust / 169 mock Rust tests and the required real
Worker/process proof. Raw log: ignored `tmp/ga-sse-recovery/startup-bound-check.log`.
Independent review approved the targeted lifetime without changing assertions.
The current PR-head CI must also qualify the resulting change before handoff.
