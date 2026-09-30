# Takos GA: execute the exact portable test inventory

Date: 2026-09-30 UTC
Status: complete source gate verified / exact-head CI and integration pending
Owner: Takos dedicated session
Required for: production_or_release; verification provenance
Grants production mutation authority: false
Repository mutation scope: `takos` only
Base: `bbb92a2afa408f4a4010d77858dac28baa98cec9`

## Gap and acceptance

The owning runner uses Git's tracked plus nonignored untracked test inventory,
then passes those repository-relative names directly to `bun test`. Bun treats
names not starting `./` or `/` as path filters. An ignored archive containing the
same suffixes therefore runs despite not belonging to the source inventory.
The notifier proof archived an old commit inside ignored tmp: Git selected 227
files, yet Bun executed 405 files / 2,265 tests, including intentional old-code
red regressions. No unrelated checkout was changed. The diagnostic is at
`tmp/ga-sse-recovery/notifier-restore-check-pathfilter-failure.log`.

Keep complete Git discovery and all online/quarantine classification. Give Bun
explicit selected file paths; do not add a skip or quarantine for the archive
or remove owning tests. A real child-process regression must discover the
canonical file in a temporary Git fixture with an ignored same-suffix archive,
execute the production helper, and prove that only the selected test ran. The
source runner must still reject an empty selected set. Independent review and
the complete gate are required before handoff.

Primary source: https://bun.com/docs/test (specific file paths start `./` or `/`).

## Regression and implementation

The real child-process regression failed against the original helper: both the
canonical marker and the ignored poison marker were written, and the child
failed. It now passes with only the canonical marker present. The runner gives
Bun explicit `./` paths, preserves already absolute paths, and uses the current
Bun executable for the child. The isolated fixture is created below this
worktree's ignored HDD tmp and removes only its own newly created directory.
Discovery, online/portable classification and quarantine rules are unchanged;
an empty selected set still fails.

Focused regression: 1 passed. The type-aware check has zero undeclared
diagnostics (98 declared existing diagnostics), scoped lint and diff checks
pass. Independent review found no concrete P1/P2. Raw red, green and type output
is at `tmp/ga-sse-recovery/portable-path-{red,green,types}.log`. The full gate is
repeated while the deliberate old-source archive remained present. It passed
with 1,335 tests across exactly 228 selected files, rather than the old 405-file
execution. All other phases, including OpenTofu and the required Rust/Worker
recovery proof, passed; exit 0 is recorded in
`tmp/ga-sse-recovery/notifier-restore-check.log`. The source inventory was not
reduced to obtain this result. Exact new-head CI remains a separate readback.
