# Takos native schema admission and private export fidelity

Base: `9db915f21577359411903001f51e47bdc8e031e5`; dedicated Takos worktree,
Draft PR #126. Main retains common contracts and final integration.

## Scope and authority

Only this Takos worktree is changed. No live database migration, deploy,
publication, billing, credential, permission grant, other worktree mutation or
historical data deletion is authorized or performed. Takos remains a personal
single-owner instance, with multiple private Workspaces and external participants.
The existing SQL files and persisted schemas are unchanged.

At the base revision, native D1 Queue events enter application handlers before the embedded
schema gate. A queued terminal transition can therefore reference the absent
0110 usage witness table. The SQL batch still fails atomically; this finding
does not establish permanent loss. Web cron also continues domain maintenance
after recording a non-ready schema. Node applies migrations at database open;
the exact externally managed `edge.sql` binding owns its schema separately.

At the base revision, the personal-data export includes `provider_sub`, contrary to its
documented redaction boundary, and omits the documented app-local revocation
metadata. This correction does not change request authentication or deletion.

## Implementation and verification order

1. Capture behavioral red regressions against the base with real full-migration
   SQLite: old schema to 0110 Queue admission, unavailable/held/failed migration,
   cron isolation, and export isolation/redaction. No fake ready statuses.
2. Admit known native-D1 Queue families only after schema convergence; otherwise
   explicitly retry every message with bounded delay before any domain handler
   or acknowledgement. Gate direct background cron and web maintenance too.
   Preserve node and exact externally managed SQL authority boundaries.
3. Remove provider subject from export and return only owner-linked revocation
   time/reason/expiry. Exclude raw revoked session IDs, other subjects and
   revocations with no subject association; retain safe local mirror metadata.
4. Run focused tests and independent review. Freeze source and run the complete
   required `bun run check` once after these code changes, with pinned Bun
   1.3.14 and coordinated HDD/resource limits. Do not weaken deadlines or gates.
5. Commit only owned changes, update PR #126, read back exact tested CI tree,
   and append qualified outcomes and remaining dependencies to the dedicated
   HDD result handoff. Test preparation is not a successful qualification.

## Retry and integration limits

Explicit native Queue retries consume the configured retry budget. Main
consumers can reach their DLQs; DLQ consumers also have finite attempts and no
further DLQ. A persistently failed schema requires operator repair before
traffic resumes. This change does not promise indefinite retention or add a
replacement-message loop. See the official [Queues retry contract](https://developers.cloudflare.com/queues/configuration/batching-retries/).

Main must qualify external `edge.sql` schema readiness, including 0110, before
routing the corresponding artifact. Whole-instance consistent recovery remains
a separate common backend/operator contract and qualification. The existing
functional proof's source/version fields are caller assertions; response-bound
served-version provenance needs an explicit transport/runtime contract proposal.
Native Cloudflare retry, alarm/quota and owner live journeys remain unverified
by these portable fixtures. No production completion is claimed.

## Evidence

The final privacy test fails against a relocated copy of the base service
(only import paths adjusted) because it exposes the provider subject. The new
service passes the full-migration SQLite fixture: one test, 15 assertions,
default migration budget unchanged. Owner/other/null revocation association,
secret redaction, safe mirror fields and before/after auth table equality are
checked. Independent review found no confirmed P1/P2. Final service SHA-256 is
`57e1d60eed0613c02d3cbd82558e5b9a3a8799195d2d7cbe8dd6fc6aa0b316c6`;
test SHA-256 is
`0940e6d5e45a1feec5316eeade1cc2c2a45f46be00a80d59f480655eaf07d855`.

The exact current notification, privacy route and privacy service slice passes
20 tests across three files, 80 assertions. A prior bare-path Bun invocation
also selected ignored historical test copies, which caused two historical
failures; its log is preserved and does not qualify the current slice. Explicit
`./src/...` paths select the intended files, as in the owning portable runner.

The native admission suite passes 11 tests / 76 assertions against real
full-migration SQLite: two deliveries per Queue family wait behind a held claim
or failed-migration cooldown, without domain SQL or acknowledgement. An injected
0110 DDL failure preserves a queued Run; a cold binding after cooldown applies
0110 and its production DLQ terminal transition commits the exact owner-bound
usage witness and terminal event. Replay leaves one witness and one terminal
event. Web/background cron blocks before domain maintenance/prewarm; node and
tagged external SQL bypass native DDL. The corrected six held-claim regressions
fail against the relocated base runtime. An earlier unheld healthy-schema
fixture incorrectly expected deferral and is preserved as discarded evidence.
Final native test SHA-256 is
`9b21eb6f6c9b3081dcbaf733121b7ca2979173d4cda6eafcf353965a9271162e`.
Format, lint and declared-debt-aware types pass with zero undeclared findings;
existing type/lint debt remains 98/111. No ledger or exclusion was changed.

Independent final frozen source review found no confirmed P1/P2 in either
delta. The complete owner gate subsequently exited zero at 16:15 UTC.

The first full invocation was invalidated by the parent's `TMPDIR` override
inside this repository: release fixtures correctly refused operator-private
paths there. HDD-backed transient SQLite fixtures also exceeded unchanged
5-second test deadlines. The owned test child was stopped after those observed
failures; its raw log/result and stop provenance are retained. With `TMPDIR`
unset, the exact affected release/usage slice passes 65 tests / 334 assertions.
All 1,436 frozen files outside docs/tasks remain unchanged. The corrected full
invocation retains normal external ephemeral fixtures, HDD Rust/OpenTofu
artifacts, nice 10, ionice 2:7 and two Cargo jobs. No guard, deadline or source
was changed to accommodate the invalid invocation.

That invocation passed all 1,646 portable tests (254 files, 11,910 assertions),
20 OpenTofu tests/plans and architecture validation, then stopped at the agent
wrapper's absent default sibling path. Dedicated worktrees require the existing
`TAKOS_AGENT_ENGINE_REPOSITORY` override documented in `/contributing/`.
The final invocation explicitly reads the repository containing pinned engine
commit `c4c3c9f0ffc3956a917b8da38f97671dbd3aea2d`, tree
`94426e636f5a87429593372424f7c20167c41268`. The gate archives that commit;
it does not copy or edit its owner's dirty worktree.

The final pinned Bun 1.3.14 `bun run check` exits zero: 1,646 tests / 254 files /
11,910 assertions in 92.70 seconds, 20 OpenTofu tests/plans, Rust format/check/
Clippy/default 96/mock aggregate 169/build, required real Worker/full-migration
SQLite/ToolExecutor/compiled process restart and Web/Worker dry-run builds.
Notification refresh is 1.612 seconds and capacity 0.842 seconds under their
unchanged 5-second limits; the native guard passes in 48.586 seconds. Type/lint
debt stays 98/111 with zero undeclared findings. No required phase is skipped.

The required production RunNotifier/usage dispatcher proof also passes:
executor stopped before delivery, one lost successful HTTP acknowledgement,
dispatch 0/1/0, revisions 3/4, two witness attempts, and one canonical input
0.024/output 0.008 meter. Tool two attempts/one effect, model two calls, usage
24/8/3, lease 8, four messages/one completion/checkpoint cleared and all four
old-authority RPC 409 checks pass. Local debug artifact SHA-256 is
`1df96340d3ca5f643e8ec7a221123e9db61dc1c5d6019ef227fcbf48334ed3b5`.
Full gate log SHA-256 is
`be12966ca4bdc8c643a0387255b39cdd2223fa5f59f7ae65e5e306608f566798`.
The existing actual OCI result remains the earlier retained-image qualification;
this slice does not rebuild, publish, deploy or claim new live OCI coverage.

Private evidence is kept under
`tmp/ga-runtime-schema-20261001` and `tmp/ga-privacy-export-20261001`;
commit/PR/CI readbacks and integration status belong in the dedicated HDD handoff.
