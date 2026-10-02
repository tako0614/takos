# Takos GA: interrupted executor to terminal usage recovery

Date: 2026-10-01 UTC
Status: final local OCI/debug usage composition, complete owner gate and
independent source review passed; committed CI pending
Owner: Takos dedicated session
Required for: production_or_release
Grants production mutation authority: false
Repository mutation scope: `takos` only
Source base: `da2e48dd80e9cbbad77d61fb9bed2c91ab7da344`

## Gap and scope

The mandatory Worker recovery proof verifies a queued terminal usage witness,
but its notifier success stub cannot prove independent delivery of that witness.
Separate native notifier/D1 and SQL recovery proofs qualify their own slices.
Connect the interrupted executor journey to the production dispatcher and
notifier using the same full-migration SQLite database and recorded owner.
Keep every existing tool, checkpoint, lease, stale-RPC and cleanup assertion.

The retained local OCI image belongs to frozen image source `f5207eb193d71f28a2fc1895e2a213a725bddf82`,
not the current whole Worker commit. Its manifest is
`sha256:4fba7740a515e902a67a623c9ff2ac4c4afd73e442a80abe4e47957e8d86f3e8`.
Compare all image build inputs before reusing it. No image build, publication,
production deploy, shared contract change, new identity/billing authority,
existing-data deletion or other-worktree mutation is authorized by this task.

## Acceptance

1. Requalify the retained OCI artifact with the current Worker. Require the
   exact manifest/config/layer/binary digests, image UID/GID 10001, readiness,
   old-init absence before reclaim, one tool effect and all four stale RPC409s.
2. Retain the queued owner/Workspace/completion witness assertion before
   independent usage delivery. Stop the replacement executor before delivery.
3. Exercise the production RunNotifier and dispatcher, with explicitly portable
   owned KV/object-store fixtures and real full-migration SQLite. Do not turn
   an unconditional success response into evidence of production projection.
4. Keep a narrow owned-fixture meter outage through terminal completion and
   executor shutdown. Drain notifier work and require zero canonical meter
   rows before restoring the recorder. Lose exactly one successful notifier
   acknowledgement after the first actual independent projection. Confirm
   queued retry and exact canonical event/rollup ownership, units and
   idempotency identities; preserve the durable Run and transcript.
5. Construct a cold notifier over the same owned storage and deliver again.
   Require a done witness with a clean newer revision, two attempts, unchanged
   canonical event identities/units and rollup ownership/scope/period/units.
   The production rollup update timestamp may advance; record it separately.
   No execution-authority renewal occurs, and a third dispatch is idle.
6. Keep the existing deadlines and required owner gate. Independently review
   the proof and its output limitations, then commit/push verified bytes and
   read back the new PR/CI. Preserve failed attempts separately.

## Current-image evidence

The current `da2e48dd` Worker with the retained image passed the actual local
OCI proof with exit0. Two native init identities were absent after cleanup;
tool2 attempts/one operation/one artifact, model2, usage24/8/3, lease8,
messages4/completed1/checkpoint cleared and stale heartbeat/checkpoint/tool/
complete RPC409s passed. The terminal usage witness was queued; the dispatcher
was not invoked. All 1,040 tracked proof/Worker/DB/image source hashes were
unchanged across this run. Own runtime tmp was empty after cleanup.

Independent inventory found all Dockerfile COPY inputs and the exact pinned
engine tree unchanged. The retained archive, manifest/config, all five layers
and unpacked binary hashes match their recorded identities. Image source has
no embedded revision label; its source association remains the frozen build
record. Mutable base tags/package indexes do not prove future reproducibility.
See `tmp/ga-container-current-20261001/inventory.md`.

Evidence: `tmp/ga-container-current-20261001/{source-before.json,oci-current-worker.log,oci-current-worker-result.json}`.
This is actual local OCI execution, distinct from the earlier preparation-only
inventory, debug-binary proof, or public image descriptor. The earlier actual
OCI and owner-fenced OCI proofs remain historical successes.

## Remaining qualification

Portable KV/object-store fixtures do not qualify native storage quota, commit
semantics or timed alarms. The model/proxy-token bridge remains substituted.
Real Accounts/registered-owner/mobile subjects, queue/SSE delivery, exact Host
or Cloudflare Container lifecycle, published/deployed artifact identity, whole
instance restore and monitoring remain unverified. Shared backend contracts
and final integration remain with the main Takoserver owner. Single-owner
deployment, private Workspaces and external participants/sharing are preserved.

## Composition implementation and qualification

The mandatory proof now uses the production RunNotifier, structured-clone
portable KV and an in-memory object store on its real full-migration SQLite.
The per-Run SQL trigger holds canonical meters absent through completion,
executor shutdown and the bounded drain of every authorized bridge RPC and
notifier fetch. After removing only that fixture trigger, the production
dispatcher performs the first successful projection and loses its HTTP ACK.
Actual journal readback proves the clean durable revision before cold reload.
The second dispatch reads that same storage, commits a newer clean revision,
and settles the original witness. The third dispatch is idle. Canonical events
remain exact; rollup update timestamps may advance while identity/units remain.

Initial debug run failed its executor-stopped assertion. A controlled real
Bun1.3.14 process reproduced `exitCode=null`, `signalCode=SIGKILL`, and reaped
code137. The prior exit-code-only predicate falsely reported it alive. The
proof now checks both exit and signal consistently in startup/liveness/stop;
the stopped-executor assertion and deadlines remain. That failure/context and
read-only SQL show completed Run, queued witness and zero canonical rows.

The second debug run passed with actual dispatcher0/1/0, revisions3/4,
attempts2 and canonical input0.024/output0.008. Review then identified a
missing bridge-RPC drain, so that run is retained as an intermediate success
rather than final first-projector qualification. The corrected source drains
authorized control handlers from before request-body reads through their full
dispatch/trace/ACK paths, along with notifier fetches.

Final corrected local OCI run passed with the retained manifest/binary above,
UID/GID10001, the original interrupted tool/checkpoint/lease assertions,
actual usage dispatch0/1/0, revisions3/4, attempts2, and input0.024/output0.008.
Both init identities and their runc states were absent after cleanup; own
runtime tmp was empty. All1,040 frozen runtime source hashes matched across
this run. Existing lifecycle/command tests passed13/71assertions. Scoped
lint/import/diff checks passed; independent final review found no remaining
confirmed P1/P2 and matched both source hashes before/after.

- Worker proof SHA: `630cabdc16b372674148d55c06ac7da1b01cc4e3a384cc8a980f7007e2511ed2`.
- OCI proof SHA: `f6c3ea1639342e45c5d1ccc0da5657d132d2c69cea576482b24b0419f5fb17c0`.
- Final OCI raw log SHA: `6239bcc93c6c22f3256b6bb9d3ac4850805613093008effb8b7c92380b4850bd`.

Evidence is under `tmp/ga-container-current-20261001/`: frozen v1/v2/v3
manifests, debug failure/log/SQL readback and signal observation, intermediate
debug result, final OCI v3 log/result, inventory, lifecycle test log and final
review. The prior da2e CI does not qualify these changed proof scripts.

The final pinned Bun1.3.14 `bun run check` exited0 (process97783): 1,633 tests,
252 files, 11,819 assertions in82.63s; 20 OpenTofu tests/plans; all Rust
format/check/Clippy/default96/mock aggregate169/build; mandatory real Worker/
full-migration SQLite/process recovery, and Web/Worker dry-run builds passed.
The new mandatory debug proof also confirmed independent dispatch0/1/0,
revisions3/4, attempts2, exact input0.024/output0.008 and unchanged terminal
authority. Native guard40.062s; capacity2.146s under the unchanged5s limit.
Declared types98/lint111 stayed unchanged with zero undeclared diagnostics.
No new exclusion, weakened assertion or relaxed deadline was introduced.

- Full-check raw log SHA: `a8de9f16c1d01b66711ec985a40f8af563dd0f94dd92aa78a25a2d2f3203ce4b`.
- Local debug binary SHA: `082c530685dbc871e11ac506a970c0f7cf10b79240bc350c01a40bbdc7a8a232`.

All1,040 frozen runtime source hashes still match, as do the original Takos
dirty diff/status and the other owner's engine candidate source/diff. New
commit/PR/CI readback is recorded separately in the dedicated HDD result.
