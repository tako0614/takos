# Canonical stale recovery and actual Container composition

Status: the local harness is implemented. Canonical initial-admission diagnostic
passed, but one guided full recovery/usage trial failed after actual replacement
bootstrap. Portable gate, commit and CI evidence are recorded in PR126 and the
dedicated handoff; they do not qualify the failed combined trial.

## Problem and boundary

At daa31e1c4, the portable native proof qualifies the canonical scheduled/Queue
claim, fencing and duplicate acknowledgement using a synthetic executor transport.
The opt-in native Container proof separately qualifies two actual Containers,
pending checkpoint recovery, lost tool ACK and first usage/cold retry, but its
replacement lease is a fixture CAS. Their successes do not establish the whole
canonical path together.

Takos remains a single-owner instance with multiple private Workspaces and external
participants. Main owns shared Forms/Host/edge.sql contracts. This slice changes
only Takos's local proof harness and documentation; it does not change production
handlers, schema, auth grants, billing, engine/wrapper/image inputs or deployment.
The original Takos checkout and engine candidate worktree are read-only.

## Implementation and acceptance

- After actual old Container destruction before a successful tool ACK, age only
  that fixture Run's heartbeat. The real scheduled delegate resets/re-enqueues it;
  a native Queue consumer owns the new UUID service ID and lease increment.
- Route the unchanged canonical Queue request through an actual native Service
  Binding entrypoint to the real executor Host. Use a Run-specific pool revision
  with one tier-1 slot, then verify the Host-selected receipt and exact DO/Docker
  identity. No replacement manual dispatch or fixture lease-CAS fallback.
- Join the native pre-send/claim snapshots, SQL receipt and public guarded
  callbacks. Preserve checkpoint, completed operation/cache, owner/private
  Workspace, one artifact, transcript, terminal usage and old-token rejection.
- Send one real duplicate Queue message after completion; require one dispatch,
  two acknowledgements and unchanged terminal Run/operation/receipt state.
- Require scheduled/Queue/Host work to drain along with existing Worker/notifier
  work before first usage delivery. Preserve actual ACK loss and 60-second due
  cold retry, exact owned cleanup and source/runtime provenance checks.

Parent owns controller/supervisor/ownership checks/tests/docs and heavy verification.
The bounded worker owns native-container-worker-fixture.mjs and the separate
transport-log helper/tests. Each file has one editor. Independent
design/source/result review has a separate read-only owner. Existing success and
failure artifacts remain immutable; new trial directories must be fresh. Retain
320/350-second bounds and existing 45/90-second phases.

Focused safety tests, a separately executed opt-in native Container trial, the
complete product gate and exact commit/PR126 CI are separate acceptance records.
Preparation, a source review or an earlier green gate is not a new trial success.

## Diagnostic preparation and verified boundary

Two full canonical attempts failed before the config request reached the Worker.
A separate limited initial-admission diagnostic passed with the exact private-owner
seed, native usage fence, guarded bootstrap, unissued-bearer rejection and lease-7
readback. It intentionally cuts config/model/tool execution, so it proves neither
recovery nor usage projection. The Node controller's deferred Miniflare response
consumption was separately reproduced with forced GC and corrected in that private
diagnostic; it does not explain the compiled agent's earlier send error.

The official opt-in proof now has an explicit diagnostic transport toggle and
bounded private snapshots for each owned physical agent. Default fixture bytes are
unchanged by the toggle. A full trial must retain all original canonical/recovery/
usage assertions and label DEBUG/snapshot timing changes; missing required logs
cannot qualify a diagnostic success. No Docker image inputs change in this slice.

## Guided full trial result

The fixed-source diagnostic trial on 2026-10-02 reached actual old tool commit and
native destruction, canonical scheduled/native Queue lease 7 to 8 with a new
service UUID, actual Host-selected isolated pool Container and replacement
bootstrap 200. The replacement config request then failed before Worker ingress;
its complete-run handler returned 200 but the authoritative Run status was failed.
The whole proof is FAILED; resumed checkpoint execution, duplicate delivery and
first usage/cold retry did not qualify. The DEBUG logs show idle-connection reuse
before the send error and a new connection for subsequent cleanup/failed completion,
but do not expose the inner error cause. No cause fix is claimed and no blind repeat
was made. The 59 raw files were sealed separately; exact owned cleanup, zero live
owned processes/Containers, prior Container protection and source/runtime bytes
were retained. Earlier individual successful proofs remain separate.

After this trial, the supervisor was adjusted to read the independently saved
native cleanup acknowledgement even when the child Run fails. This preserves the
failed verdict while making cleanup evidence visible. The trial's source freeze
and sealed raw report are not rewritten for this post-trial reporting change.

## Remaining limits

Fixture heartbeat ageing does not demonstrate a real five-minute outage or whole
workerd restart. Hosted lifecycle/published image, actual owner OIDC/MFA and
whole-instance SQL/KV/R2/Queue/alarm backup/restore remain unverified. The retained
preloaded image's operator commit and unchanged image inputs are separate from
current Worker source and published provenance. Common substrate gaps remain with
the main owner; this work does not claim GA, merge or release completion.
