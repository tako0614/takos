# Takos GA: personal export across owned private Workspaces

Date: 2026-10-01 UTC
Owner: Takos dedicated session
Status: verified local source; CI and current native qualification pending
Required for: security, authorization, production_or_release
Repository mutation scope: takos only
Source base: 58aebb4e6128856bf88155dcae468ad2ab79683d
Grants upstream permissions or production mutation authority: false

## Product requirement and observed gap

The user defines Takos as personal self-deployed single-owner software. One local
Principal can own a default and multiple private Workspaces. External participants
remain separate from instance ownership. `docs/platform/spaces.md` is the owning
Workspace authority contract; `docs/legal/privacy-rights.md` promises app-local
repositories, threads, messages, Runs and memories in the personal export.

At the source base, `buildDataSubjectExport` selects those Workspace collections
using only `account_id = Principal.id`. Additional Workspaces have independent
IDs, so their content and associated messages/Runs are omitted. The separate
Workspace export endpoint lists non-deleted threads and per-thread URLs; it does
not discharge the personal export promise across those collections.

Independent ownership review classified this as a Takos application correction.
It requires no shared Form, Interface, Accounts or runtime contract change.

## Implementation ownership and order

1. Parent owns `privacy-rights.ts`, the route mock's additive export shape,
   product docs and this task ledger.
2. Existing privacy worker owns only the real-SQL service test. Preserve its
   already-qualified authentication redaction test and record a controlled red
   against the exact source base before accepting a green result.
3. Independent reviewer checks the final frozen source and authority boundary.
4. Parent runs the complete required `bun run check`, then commits/pushes the
   verified bytes and updates Draft PR126 and the dedicated HDD handoff.

The original `/root/dev/takos/takos`, short-term engine candidate and all other
worktrees are read-only. Baseline source/protected hashes and verification logs
are kept under ignored `tmp/ga-workspace-export-20261001/` on HDD.

## Intended resulting behavior

- Preserve the existing default `account_id = user.id` personal-data scope.
  Add Workspaces using the existing active Principal, active Workspace,
  matching owner and active owner-witness gate. No invitation, membership role,
  historical account or matching external subject can enlarge this set.
- Include the existing public Workspace summaries and SQL repository/thread/
  memory rows in that authority set. Include messages from those threads and
  Runs whose thread and Workspace account agree.
- Keep account/profile, settings, identity/session/revocation metadata, usage
  and notifications on their existing subject-specific predicates.
- Preserve messages from external participants in an authorized private thread;
  do not treat those participants as instance owners or delete their features.
- Avoid SQL parameter arrays proportional to all Workspaces or threads. Preserve
  the existing per-collection ordering after collecting owned Workspace rows.
- Read only. No account, witness, credential, sharing or data mutation; no persisted
  schema change and no deployment, publication, new billing or authorization grant.

This export covers the declared app-local SQL collections. It is not an instance
backup, a consistent cross-store snapshot or a restore artifact. Native backend,
R2 payload retrieval, live owner clients and whole-instance recovery remain
separate qualifications.

## Acceptance evidence to record

- Exact source-base red for missing additional Workspace content.
- Preserve default personal data for an active legacy Principal without a
  default owner witness, without repairing or otherwise mutating that witness.
- Full-migration real SQLite green covering default and additional Workspace
  data, external-participant content retention, other/guest/forged/inactive
  ownership exclusions and mismatched Run/thread ownership exclusion.
- Database before/after evidence of read-only behavior, existing secret redaction
  preservation, and source-backed bounded SQL bind shape.
- Independent source review, unchanged declared debt/deadlines/quarantine,
  complete local owner gate, exact committed tree and CI readback.
- Remaining main-owned contracts and unperformed native/live qualifications
  retained explicitly in the dedicated handoff.

## Review and supplemental native qualification

Independent review caught an initial regression that would silently drop the
default subject's existing content when a legacy default owner witness is absent.
The final implementation preserves the prior subject-ID scope and admits only
additional IDs through the strict Workspace gate. Workspace summaries remain
gate-derived. Export does not invoke the separate witness-repair path.

A read-only native-proof inventory found a later successful attempt 10, beyond
the earlier incomplete native D1 harness run. Its native D1 trigger rollback and
DO eviction/cold retry succeeded for the recorded source snapshot. Usage SQL,
dispatcher, producers and 0110 hashes still match, but `run-notifier.ts` changed
afterward in `c339f6708` for durable receipt indexes. That evidence cannot qualify
the exact current notifier. A bounded fresh harness copy under ignored
`tmp/ga-native-d1-current-20261001/` will supplement the required portable owner
gate for the current source; preserve the original attempt-10 evidence unchanged.
Keep its 70-second watchdog/75-second external bound and native assertions.
This is a source-driven requalification, not a repeat for the progress report.
Its constrained fixture DDL plus exact 0110 is not a full native migration replay
or a hosted D1, quota, timed-alarm or deployed-container qualification.

## Completed local verification

The final service/test/docs/route shape passed independent source review with no
confirmed P1/P2. The default witness regression found in the first draft was
corrected before source freeze. Service SHA-256 is
`b2d4894563cf63362fdb8cfb0c5275a107e2293148180e0e686794b0aacbb6f9`;
test SHA-256 is
`7743cd1e3d7b8a8c389ac48e746ba0edf7198c1eecc1f05c1717678fdb08e5e7`.

The final test, with only its service import relocated, fails against the exact
source-base service because both additional Workspace repositories are absent.
The corrected implementation passes two full-migration SQLite tests / 39
assertions. It checks the negative ownership graph, external-participant content,
cross-account Run rejection, default witness absent/present, no duplicate default
rows, global ordering, subject-only settings/notifications and before/after table
equality. Actual message queries bind one value and Run queries two per Workspace,
including a default with three threads; no generated thread-ID array is used.

The complete pinned-Bun owner gate succeeded on 2026-10-01 at 17:11:31 UTC in
273.98 seconds. Portable tests: 1,647 / 254 files / 11,934 assertions, 88.85 seconds;
OpenTofu, architecture, Rust format/check/Clippy/default and mock tests, native
notifier guard, required compiled Worker process-restart proof and both dry-run
builds also passed. Lint/types have zero undeclared diagnostics; existing declared
debt remains 111 / 98. No deadline, quarantine or debt ledger changed. Normal
`TMPDIR` was unset; the documented engine repository override selected the exact
committed engine pin, not the protected dirty engine candidate. Artifacts stayed
on HDD, with nice10/ionice2:7 and two Cargo jobs. All 1,436 frozen source files
outside docs/tasks were unchanged during the gate. Raw gate log SHA-256:
`a7d3d4b9ae3147b7b8cf7c1442ca1bad24f3d6c4a233d834aaf7c339bb9d4431`.

The required process proof uses the production notifier and dispatcher with
full-migration SQLite and portable persisted KV/object storage: executor stops
before delivery, one successful HTTP acknowledgement is lost, cold retry delivers
once, and idle dispatch delivers zero. Canonical meters remain 0.024 / 0.008,
durable head revisions 3 / 4, witness attempts 2; tool attempts 2 / effect 1 /
artifact 1, terminal lease 8 and all four stale execution RPCs return 409.
This does not qualify a hosted backend or a newly published Container.

An early global lint call observed unfinished worker test imports/helpers; those
WIP diagnostics are retained in `lint-initial.log` and are not a final result.
The frozen complete gate passes without exclusions. Evidence, baseline copy,
review, hashes and raw logs are under ignored `tmp/ga-workspace-export-20261001/`.
Exact committed tree and CI outcome are recorded separately in the dedicated HDD
handoff after publication of this source branch, not assumed here.

## Current native supplement: incomplete

The fresh current native harness ran once, exit 1 in 14.212 seconds. It logged a
dispatcher result of zero after the injected native output-meter trigger failure,
then the binding-proxy SQL readback failed with an unexpected socket closure.
It did not complete native SQL rollback readbacks or eviction/cold retry. Do not
claim this as a current-source native success or infer a production regression
without diagnosis. All 17 recorded production hashes and the parent freeze
manifest were unchanged; fresh local fixture processes/state/bundle were torn
down, and original attempt-10 evidence is byte-preserved. Raw diagnostics are in
`tmp/ga-native-d1-current-20261001/native-d1-proof/`. Independent investigation is
continuing; no blind retry, timeout relaxation or portable substitution was made.
