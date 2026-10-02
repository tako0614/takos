# Canonical stale recovery and actual Container composition

Status: the local harness is implemented. A later fixed-source diagnostic trial
passed the complete canonical recovery/usage composition in 264.598 seconds.
Its separate outer socket observer failed conservative whole-session coverage;
that verdict and earlier failed trials remain unchanged. Portable gate, commit
and CI evidence are recorded in PR126 and the dedicated handoff.
An independent notification preference persistence defect found during the next
bounded observation has been fixed and verified separately, as described below.

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
The later notification follow-up changes a Takos-owned production service and its
regression tests; it does not alter common contracts or those protected inputs.

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

## Subsequent TCP observation: failed, with a narrower transport finding

One reviewed outside-source wrapper ran the unchanged opt-in native CLI with
text-only, zero-payload SYN/FIN/RST capture on the fresh callback port. Exact fresh
Docker identities and a pinned network namespace joined host and physical-agent
views. This attempt failed in 123.334 seconds during the initial lease-7 config
send, before tool execution or replacement. A matching host-origin RST arrived in
the agent namespace about 0.1 milliseconds before the compiled agent's send error;
the Worker recorded no config ingress. The Run was failed with zero usage.
Both capture views reported zero dropped packets and were reaped, but only the
initial physical agent existed. Thus the full diagnostic and native proof remain
FAILED. All 60 raw files, original source/runtime and exact owned cleanup were
preserved; prior successful and failed attempts were not overwritten.

The packet filter excludes payload-bearing control packets. A host-source address
does not identify the actor that closed/reset the socket. The actual native binary
was the nested workerd 1.20260721.1, correcting the earlier root-install version
assumption. Its corresponding public upstream source uses a five-second HTTP idle
wait after a response; the reset was about 0.52 seconds after bootstrap success, so
connection age alone does not establish idle expiration. Binary-to-upstream build
attestation, request-local port and response Connection metadata remain absent.
Next investigation must join socket ownership with the close/reset transition;
no client pooling, timeout or shared-foundation cause fix is claimed.

## Independent notification preference fix

The failed trial also exposed a separate persistence bug: default preferences have
nine types and three channels, and one six-column insert bound 162 parameters.
Actual local Miniflare/workerd D1 rejects more than 100. The service caught default
creation failure and returned fallback choices, hiding missing persisted settings;
a fresh full preference update could fail. This warning occurred after the agent
transport error and is not claimed to explain that error.

Both creation paths now split inserts into at most 15 rows / 90 parameters and use
the existing atomic statement helper. Unsupported persisted push types are also
disabled in bounded atomic updates. Existing opt-outs, account-row predicates,
supported push taxonomy and the original creation atomicity remain. Fixture
account rows test data isolation; they do not define multiple instance owners or
remove external participants. No schema, auth, grants, new billing, shared
edge.sql contract, image or deploy changes are involved.

The old production service was frozen and reproduced RED on actual local D1:
the 101-parameter canary failed and only the previously seeded 1 of 27 choices
persisted. The unchanged fixed production service then passed a separate 13.703-
second native D1 proof: all 27 defaults and a full fresh update persisted, repeated
reads preserved an opt-out and unrelated fixture row, 110 unsupported legacy push
rows were disabled, and injected failure in the second insert left zero partial
rows for both creation paths. Native D1 was disposed. Six portable regressions
also cover the bounded writes, preserved settings and late-insert rollback.
RED/GREEN raw files and source freezes are sealed separately. This qualifies local
notification persistence, not cloud D1, auth, sending, Run recovery or usage.

Independent source/evidence review accepted this notification fix. The first new
required product check ran 1695 tests: 1692 passed, with one permissive-session
fixture failure and two existing native 70-second watchdog failures. The deliberately
invalid session fixture had inherited umask 077 and become a valid 0600 file;
explicit chmod to 0644 now makes that rejection test deterministic, with all 15
focused tests passing under umask 077 and independent review. Production auth and
grants are unchanged. Native proof deadlines and success predicates are unchanged.

A second check retained CPU niceness and two build jobs while removing the prior
best-effort disk priority. It also failed: HTTP schema admission remained pending
at 101/106 after two allowed post-release requests, the notifier guard hit its
internal deadline, and usage schema admission remained pending at 93/106 after two
allowed requests. A 17:02 UTC host snapshot showed IO pressure full avg10 85.96%,
with CPU/memory pressure approximately zero and ample disk space. These are
environment observations, not proof that IO scheduling caused every failure.
The second check completed with 1691 passed and four failed out of 1695 tests /
262 files; the fourth failure was the stale Run proof's unchanged 70-second bound.
Neither check is a new complete-gate success. Failed attempts are preserved
separately from the six focused and isolated native notification successes, and
from the earlier verified 871b9ee05 / CI37028181674. No further whole-check retry
or relaxed schema admission/deadline is used to manufacture a passing result.
The unexecuted later gate stages were invoked separately: architecture validation
and pinned-engine Rust format/check/clippy/tests/production binary build passed,
but the compiled Worker recovery fixture timed out during its full SQLite
migration/seed after the existing 150-second bound, before either agent ran.
This is also a failed recovery attempt, not a new compiled-recovery success.

## Remaining limits

Fixture heartbeat ageing does not demonstrate a real five-minute outage or whole
workerd restart. Hosted lifecycle/published image, actual owner OIDC/MFA and
whole-instance SQL/KV/R2/Queue/alarm backup/restore remain unverified. The retained
preloaded image's operator commit and unchanged image inputs are separate from
current Worker source and published provenance. Common substrate gaps remain with
the main owner; this work does not claim GA, merge or release completion.

## Later observed composition and next bounded qualification

On 2026-10-02, one unchanged native CLI at 1076e9a81 passed with diagnostic DEBUG
and private socket observation: old physical Container died before tool success
ACK, canonical cron/native Queue claimed lease 8 and a new service UUID, the real
native Host selected a second compiled Container, and the original checkpoint
resumed to completion. Duplicate Queue delivery kept one Host dispatch and one
operation/effect. Both physical executors and producer work were stopped before
first usage projection. After loss of its successful ACK, a new notifier instance
with the same DO identity retried after the real 60-second due without duplicate
meters or rollups, then idled. Native cleanup returned two HTTP 200 acknowledgements;
source/runtime bytes were unchanged and the owned process group was empty.

The native supervisor qualified this local composition. The outside socket
observer exited unsuccessfully when workerd ended naturally, so complete observer
coverage did not qualify. Instrumentation perturbs timing; this result establishes
neither the cause/fix of earlier config-send failures nor ordinary uninstrumented
reliability. The preloaded image's operator-supplied source commit is not a
current-HEAD image build attestation.

The opt-in `--actual-stale-window` mode retains the default 320/350-second
watchdogs and 45/90-second phases. It adds a separate bounded 315-second wait
allowance, proves explicit manual-age rejection without a changed SQL snapshot,
and requires no cron/Queue/Host claim before the real five-minute heartbeat
threshold. Wall and monotonic time, full persisted snapshots and the early
invocation are checked before the same recovery and usage path. The supervisor
independently checks the child mode, budgets and matching fresh evidence file.
Default heartbeat-age evidence keys and the original phase deadline remain.

Twenty focused CLI/ownership/qualification tests passed, including execution of
the generated manual-age route with zero SQL calls and rejection of incomplete,
forged or early qualification records. These are preparation; the prior 264.598-
second success used fixture heartbeat ageing. New native trial and owning gate
results are recorded separately in the dedicated and shared progress handoffs.
The mode proves the real heartbeat threshold, not 300 seconds of physical
Container absence. Whole-workerd restart remains separate: the installed Miniflare
Queue broker is in-memory, so a queuePersist option cannot establish queued-message
durability across a workerd restart.

## Actual-window trial failure and canonical checkpoint binding correction

The first actual-window trial at `c1752f352` destroyed the witnessed old physical
Container before the successful tool ACK, then failed in the controller baseline
assertion. It never reached the five-minute wait or a replacement Container.
The existing canonical checkpoint witness does not contain a `runId`; the
assertion and its previous synthetic positive test incorrectly assumed that field.
The failed trial, raw files, cleanup outcome and prior source review remain sealed.
The separate portable gate and CI at that commit passed 1,700 tests; they did not
qualify this actual-window native path.

The correction binds the real D1 Run row and stored checkpoint hash to the old
service/lease, canonical checkpoint selectors and exact old Container witness.
Inline byte count and serialized hash must match the stored UTF-8 bytes; R2
pointers retain their encoded Run/service/lease namespace and independent payload
hash. The canonical checkpoint producer remains unchanged. The positive test now
uses that producer, and negative tests mutate matching top-level/recovery witnesses
together to require actual stored-value validation. Only bounded selectors and
hashes are saved before a failed baseline assertion; raw checkpoint and token
material are excluded. Twenty exact focused tests and the scoped type check passed.
These checks prepare the corrected native trial; its outcome is recorded separately.

## Observed actual window and repeated recovery enqueue

One new observed trial at `c667ed87c` crossed the real heartbeat threshold:
wall 301,365 ms and monotonic 300,098.3478 ms. Manual ageing returned 409,
early scheduled invocation emitted no Queue message or Host dispatch, and the
owner/Workspace/checkpoint snapshots remained unchanged through the threshold.
The full trial FAILED after 406.644 seconds; this is a threshold witness, not a
completed Run or usage qualification.

Canonical readback contained two accepted sends for the same Run, one actual
Host response 202 and one Queue `ack()` call. The controller rejected the 2/1/1
cardinality. Its failure text does not establish missing ACK or a phase timeout.
The stale-running recovery changes the row to queued with a null heartbeat;
the following stale-unclaimed selector can select it again before Queue claim.
An actual SQLite composition regression must confirm this path before fixing
the queued recovery heartbeat to the existing unclaimed-retry cooldown. Keep
send-failure rollback, delayed unclaimed retry, lease claims, checkpoint state
and the native deadlines/qualification predicate intact.

The 66 raw files were byte-sealed and independently checked without opening a
SQL handle on the evidence databases. Observer coverage separately failed on
natural workerd exit. Native cleanup returned two HTTP 200 acknowledgements but
its final readback still found the newly created proxy running. A separate parent
cleanup joined the fresh full ID, Run/name, pinned image and PID/startTicks/netns,
stopped that one proxy, then verified all four fresh agent/proxy identities absent
or stopped and the preexisting Container preserved. This does not repair the raw
native cleanup failure. All 1,608 source and six runtime hashes and the original
Takos/engine worktree protections matched before and after the trial. No unchanged
native retry, image operation, shared contract or deployment followed.

The actual in-memory SQLite composition reproduced two sends before the fix.
Stale-running recovery now records a fresh queued retry heartbeat, matching the
existing stale-unclaimed cooldown; the latter cannot immediately select the row
again. A still-unclaimed row becomes eligible after a later stale threshold.
The existing failed-send rollback to stale running is unchanged. The regression
checks the saved checkpoint, private Workspace/requester/thread and lease, a
later retry and preservation of a replacement claim. The final exact-path cron
suite passed six tests in one file; an earlier broad selection that also included
ignored baseline copies is not used as current-source suite qualification.
This is portable SQLite/source verification. The changed-source owning gate and
CI are recorded separately, and no corrected actual-window native success has
been claimed.

The pre-fix production source was also checked with the final exact-path test
under pinned Bun 1.3.14 and reproduced the two-send failure; the reviewed fixed
source bytes were restored immediately afterward. The existing native stale-run
proof and its report test now require a canonical ISO queued heartbeat within
the observed scheduled invocation window instead of the old null value.
Queued status, unowned service, lease 7 and all later claim/authority/checkpoint
assertions remain. This expectation change does not relax the Container proof's
1/1/1 cardinality or any phase deadline.

The first changed-source complete gate stopped at three new test type errors
before portable tests: libsql's Row type was compared/cast as a plain object.
The test now normalizes its enumerable row values to a record and narrows the
heartbeat with a runtime string guard. The final exact-path suite again passed
six tests, and the type gate passed with no undeclared diagnostics. The failed
gate log is retained; later complete-gate and CI results stay separate.

The corrected gate passed 1,724 of 1,725 portable tests but failed the parent
stale-run report assertion. Its child native D1/Queue proof succeeded and stored
a valid fresh heartbeat. A pinned Bun 1.3.14 micro-reproduction established that
the asymmetric string matcher mutated the received heartbeat into an object
before Date.parse. The parent now checks its scalar type without that matcher;
the fresh ISO/window and all claim/authority assertions remain. This gate's
failure and the successful child report retain their distinct qualifications.
