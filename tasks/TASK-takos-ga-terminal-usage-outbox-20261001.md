# Takos GA: terminal usage projection recovery

Status: source frozen; independent review and full local qualification passed.
Exact committed bytes and head CI are recorded in the dedicated HDD result.
Base: 890ad24fb34fa260d8cb3b9a492535431f771303.

## Scope and authority

Only Takos in the dedicated worktree is changed. Main owns common contracts and
final integration. No deployment, published artifact, commercial billing,
external identity grant, other worktree edit or destructive data operation is
authorized or performed. Takos remains one configured instance owner, with
multiple private Workspaces and external communication participants.

The terminal SQL transaction can succeed before a best-effort notifier emit is
accepted. That leaves committed SQL token usage without a notifier dirty
revision. Search and user-notification outboxes are independent responsibilities;
their success cannot serve as the authority for usage projection.

## Implementation order

1. Add a Takos-private, additive SQL usage-projection outbox and generated runtime
   migration set. New code requires migration first; an older Worker may ignore
   the retained table. Do not drain or delete historical data in a migration.
2. Insert one deterministic witness in both terminal transaction builders under
   the winning run/status/completion-key predicate. Include completion, failure
   and cancellation, independent of a requesting user and search eligibility.
3. Capture Run Workspace and its Principal owner in the witness. The independent
   dispatcher validates the current configured issuer/subject, active Principal
   and unchanged Workspace ownership before projecting. Former-owner and
   conflicting data require visible repair; never infer a new owner or transfer
   existing data. This is metering recovery, not renewed execution authority.
   Enforce the recorded witness inside the atomic projection SQL group and on
   ordinary automatic/alarm projection too. A dispatcher check before an await
   is not a fence against an intervening owner or identity change. A zero-meter
   result still needs an authority proof before the DO acknowledges its revision.
4. Use bounded, independently caught cron dispatch with exact claim tokens,
   stale-claim recovery, due retry/backoff, success readback and visible failures.
   Reuse the existing private notifier usage-project endpoint and canonical
   cumulative fixed-key SQL projection. A crash or lost acknowledgement replays
   the same logical effect. Search failure must not suppress recovery.
5. Prove same-transaction rollback/CAS-loser isolation, exact retries, all
   terminal statuses, claim collision/crash/lost acknowledgement, owner fences,
   and composed SQL terminal + unaccepted notifier emit recovery. Run independent
   review and required complete bun run check after freezing changes.

No automatic scan/backfill of all old terminal Runs is included. A bounded
reconciliation requires an explicit cohort and reviewed inventory. Rows remain
available for audit/repair; blocked dispositions do not silently become success.
Receipt growth/tree/migration/converter is a separate remaining source task.

## Evidence and handoff

The dispatcher suite passes 23 focused tests: concurrent/stale claims, delayed
old RPCs, lost HTTP/SQL acknowledgements, exact persisted success readback,
malformed replies, owner/Workspace rejection, and 5-second RPC/body plus
30-second dispatch bounds using a controlled clock. SQL stages are bounded too;
a timed-out claim that commits late remains stale-replayable, and a lost or
timed-out success readback can confirm the exact persisted witness and revision.
Private rejection diagnostics are bounded and sanitized. Only explicitly
diagnosed authority/fixed-key/rollup identity conflicts become blocked; generic
SQL/numeric/month-anchor failures remain retryable, without data transfer.
The composed full-migration
SQLite fixture uses the real terminal builder and RunNotifier: an unaccepted
emit, cold retry and lost HTTP acknowledgement preserve one canonical meter row.
All 113 focused tests across eight files pass (426 assertions), including the
23 dispatcher cases. The import-only relocated, byte-exact 890 terminal
producers commit SQL usage but leave no recovery witness or canonical meter;
the expected-one assertion fails behaviorally. Format, lint, types, generated
migration set and migration safety pass, preserving existing debt counts.
Independent final source review found no remaining confirmed P1/P2 at the frozen
20-file manifest. The required complete local `bun run check` exited zero:
1,603 tests / 249 files / 11,127 assertions, 20 OpenTofu tests, all Rust checks,
Clippy, default 96 / mock aggregate 169 tests, required real Worker/full-migration
SQLite/ToolExecutor/process recovery, and Web/Worker dry-run builds. Existing
type/lint debt remains 98/111, with zero undeclared diagnostics. The native
notifier guard proof passed in 47.161 seconds with observer 200; docs build
passed in 3.28 seconds. The Worker recovery proof now requires exactly one
matching queued terminal usage witness; its RUN_NOTIFIER remains a local stub.
All frozen source hashes still match after qualification. Commit and exact-head
CI readback belong to the dated dedicated HDD result; local success alone does
not establish CI or remote backend qualification.

An isolated cached PostgreSQL 16.14 fixture executes captured production-helper
queries with two real sessions. Four authority mutations (Run, Workspace,
Principal, exact OIDC identity) commit before the old 890ad24fb meter group,
reproducing the missing authority fence. Current SQL records an actual
`pg_stat_activity.wait_event_type = 'Lock'` for each mutation until projection
commit. Eight further cases reject changed authority before the atomic group,
including zero meters, and leave no meter, rollup or assertion row. The current
helper hash is unchanged through these 16 cases. The harness only converts
libsql conflict-column qualification, constant truth values and timestamp
defaults to PostgreSQL syntax; the authority assertion is unchanged. This is
local captured-query evidence, not the common backend adapter or production
transaction qualification. The owned fixture container was removed.

Evidence is under ignored `tmp/ga-terminal-usage-outbox-20261001/`, including
`implementation/`, `red-producer/`, `dispatch-tests/` and
`postgres-proof/execution-f53173c3b99a/`. This final PostgreSQL run recaptures the
frozen recorder `4ab766b7f9c10d5908dd9292286ba7f060cb711301fd66598c9066b56a3c4039`,
including the new identity preflight; all 16 cases and owned-container cleanup
pass. The older run is preserved as dated evidence.

The native workerd/D1 fixture also passed using the real projection/dispatcher
and RunNotifier, native D1, legacy KV Durable Objects and exact migration 0110.
It uses constrained fixture tables, not a full migration replay. Normal
projection writes one canonical row per token meter; a wrong-owner witness is
rejected with private typed 409 and byte-identical SQL readback. A named fixture
trigger then aborts the output meter inside the native batch: zero events,
rollups and transient assertions remain, and the outbox stays queued without a
logical usage ACK. Removing only that fixture fault and actually evicting the
native DO allows cold retry to persist the two canonical rows and exact done
witness (attempts 2 / revision 3). The final fault/recovery run passed in
20.382 seconds, within its unchanged 75-second deadline. Both successful result
manifests match the frozen production source. The normal/409 result records an
earlier harness SHA whose bytes were not separately snapshotted; the final
fault/recovery harness is retained. Failed setup/diagnostic attempts are dated
separately and are not counted as qualification. Runtime: Bun 1.3.14,
Miniflare 4.20260721.0 / workerd 1.20260701.1. The owned fixtures were disposed.
Evidence: `native-d1-proof/result-success-route.json` and
`native-d1-proof/result-fault-recovery.json` under the same ignored directory.

Live owner/mobile,
remote backend durability/alarms/SQL concurrency, actual Container/image and
whole-instance restore/monitoring remain unqualified.

Keep the additive outbox across code rollback; do not remove pending witnesses.
Any eventual removal needs a separately reviewed drain/repair plan. No production
migration or rollback is executed by this work.
Schema compatibility with an older Worker is not proof that it enforces the new
owner witness. A code rollback must stop unfenced projection/writers or use an
artifact that honors the witness and preserves pending recovery obligations.
