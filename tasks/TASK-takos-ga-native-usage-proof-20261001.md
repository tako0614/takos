# Takos GA: permanent native D1 usage recovery regression

Date: 2026-10-01 UTC
Owner: Takos dedicated session
Status: commit92f6480 native proof/full gate/CI passed; log-chunk full gate passed, CI pending
Required for: production_or_release verification
Repository mutation scope: takos only
Source base: ac5804aedeb80b6ef75b9e04e600961239faaf95
Grants upstream permissions or production mutation authority: false

## Observed verification gap

The required product gate covers full-migration SQLite and compiled Rust process
recovery, including one lost successful usage ACK and a cold idempotent retry.
Its native notifier test covers native DO/R2 state preservation without D1.
No permanent gate exercises the complete embedded migration set and terminal
CAS/usage witness/projection recovery on native workerd D1.

The isolated ignored Node-host fixture passed once in 52.239 seconds, applying
all 106 migrations with the unchanged production migration budget, proving
exact terminal-witness failure rollback/idempotency and native DO usage recovery.
Its evidence remains immutable under
`tmp/ga-native-full-schema-20261001/full-schema-proof-v2/`. That fixture used
compatibility date 2026-07-21; it does not prove the deployment configuration's
2026-04-01 date and complete flags. The permanent test must read and exercise
`deploy/cloudflare/wrangler.toml` and record its actual configuration.

The first permanent focused attempt failed in 24.821 seconds. The harness
compared generated entries including SQL against native `{name,sha256}` entries;
the normalized entries agree. Independently, the default migration admission
returned `pending` at 94/106 with the exact 12-entry suffix and retry hint 5.
The failed log, bundle/state and result remain immutable in ignored evidence.
The comparison is corrected, and the proof now covers the source-defined pending
continuation explicitly: at most two admissions, exact progress and prefix
preservation, unchanged production defaults and unchanged 70/75-second bounds.
This does not relabel the failed attempt as success.

The corrected focused v2 proof passed on 2026-10-01 at 20:09:51 UTC in 52.882
seconds (1 test / 37 assertions). Actual deployment compatibility settings were
used. Initial pending was 92/106 with a released claim; after the real 5.020-second
hint wait, the single continuation reached ready106/106 while preserving all
prior ledger rows. Terminal witness fault/idempotent completion, usage batch
rollback, native DO replacement/cold retry and unchanged owner authority passed.
All 1,572 frozen repository files and 130 selected production/config sources were
unchanged; 155 post-build metafile inputs were rehashed after the proof. Owned
processes and the successful isolated fixture were removed. This focused result
is separate from the required full gate and current-head CI.

The complete pinned-Bun `bun run check` passed at 20:16:19 UTC in 311.068 seconds:
1,648 portable tests / 255 files / 11,968 assertions, OpenTofu, architecture,
Rust format/check/Clippy/default/mock tests/build, native notifier, mandatory
full-SQLite/compiled-process recovery and Web/Worker dry-run builds. The native
D1 proof within this gate used one ready106/106 admission and passed in 39.375
seconds; the standalone pending-to-ready qualification remains separate.
All 1,572 frozen repository files remained unchanged during the gate. Types98
and lint111 remain declared with zero undeclared diagnostics. The only edit
after the gate is this documentary status/result update; runtime sources still
match the verified hashes. Exact committed-head CI is pending at this snapshot.

## Ownership and order

1. Native fixture worker owns only `scripts/prove-run-usage-native.ts` and
   `scripts/lib/build-native-proof-fixture.ts`.
2. Parent owns the isolated child test, CI Node setup, local-development docs,
   this ledger, final integration and all heavy verification.
3. Independent reviewer checks the frozen combined delta and native proof
   scope; no shared contract is changed here.
4. Parent runs a focused native regression, the complete required `bun run check`,
   then commits/pushes verified bytes and reads back Draft PR126/current-head CI.

Only this dedicated worktree is writable. Original UI changes, the uncommitted
engine candidate, other worktrees and earlier evidence are preserved. Normal
heavy concurrency stays within two process groups with main-owner priority.

## Required behavior

- Node controls the installed Miniflare runtime; the active pinned Bun executable
  compiles the Worker only. CI pins the already-qualified Node 26.1.0 host with
  a SHA-pinned setup action. No added install grants, credentials or publication.
- Each test has isolated fresh state, strict JSON output, recorded actual
  host/compiler/workerd and bundle/source/input hashes, an unchanged 70-second
  inner bound, and a supervised 75-second outer process-group bound. Missing
  native runtime fails instead of skipping or falling back to portable storage.
- Production `ensureSchemaReady(DB)` uses default options. The first status is
  preserved. Only a validated pending prefix with a released claim and retry
  hint 5 permits one explicit continuation after the real-time hint; all prior
  ledger rows must remain unchanged and the ledger must grow to the full set.
  Failed/applying, no progress or a second pending result fails without another
  admission. An extra call is allowed only after ready to prove the cache no-op.
  All raw/embedded checksums, ordered ledger rows and final trigger catalog agree.
- The exact native witness-trigger fault leaves Run status/usage/completion key,
  terminal event and witness uncommitted. Removing it enables one terminal event
  and owner-bound witness; identical completion input is idempotent.
- An output-meter trigger leaves zero usage events, rollups and assertions and
  no logical ACK. Explicit native DO replacement and cold retry produce exactly
  the canonical input/output rows and durable done witness without changing the
  configured owner's OIDC/private Workspace authority.
- No migration budget, existing deadline, declared type/lint debt, quarantine,
  production schema or authority is weakened. Failed diagnostics remain available
  in the test's own isolated output; owned processes are always supervised.

## CI evidence follow-up: complete report chunks

Commit92f6480 passed current-head CI36920598219 with 1,648 tests and all16 steps.
Its tested merge d6c4a8e503813c70b5081dc85dd25f5f1b3780a3 has tree
45de97710979afc2c3e9d3e8bf5545c994a7acd8, equal to the committed head.
The native test passed all internal assertions, but its large JSON report was
truncated at 65,536 characters in the raw CI log, losing the later hash inventory.
The wrapper now emits the same report as ordered 4,096-character JSON chunks
with a full-report SHA256, index and total count. Controller stdout/result-file
checks and native domain assertions, bounds and cleanup remain unchanged.

Offline execution of the actual changed logger on the saved qualified native
report produced51 chunks, max4,652 bytes/line, exact reassembly and matching
SHA256, with all130 source and155 input hashes restored. Independent delta
review found no confirmed P1/P2. A fresh full gate and committed-head CI/raw-log
reassembly are pending for this logger follow-up; offline evidence alone does
not prove GitHub preserves every record. This modifies only the parent-owned
wrapper and its guide/ledger, within the existing release-verification scope.

The follow-up complete `bun run check` passed at20:44:23 UTC in296.682 seconds,
including1,648 tests/255 files/11,968 assertions and all remaining gate phases.
Its native proof passed in40.326 seconds with first-ready106/106. All47 emitted
chunks were present, maximum envelope4,606 bytes, and reassembled to digest
2cb173fc5e29a6053bbda77170e9a4e8d8823a6b8829569330e1a402c0a1e7a7
with all130 source/155 input hashes. All1,572 frozen repository files remained
unchanged during execution, and the owned process group was absent. Only this
documentary result/heading update follows the gate. Committed-head CI/raw-log
reassembly is still pending at this snapshot.

## Qualification limits

This is local native workerd evidence using the deployment's compatibility
settings, not a deployed Worker or hosted backend. It does not establish native
lost HTTP ACK or compiled process/Container composition, populated upgrade,
arbitrary-host convergence or externally served HTTP schema admission,
external edge.sql readiness, response-bound release
provenance, backend alarm/quota/concurrency, real registered owner clients,
published Container lifecycle or whole-instance cross-store backup/restore.
Single-owner software, additional private Workspaces and external participants
remain the product premise. Main owns shared contracts and final integration.

No production deploy, image publication, merge, new billing/grant, credential,
existing-data deletion or other-worktree edit is authorized by this ledger.
