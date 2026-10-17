# Takos GA: exact local Container artifact qualification

Date: 2026-09-30 UTC
Status: local OCI recovery and complete source gate verified / exact-head CI and integration pending
Owner: Takos dedicated session
Required for: production_or_release
Grants production mutation authority: false
Repository mutation scope: `takos` only
Source base: `bbb92a2afa408f4a4010d77858dac28baa98cec9`

## Gap and acceptance

The required Worker/process proof verifies a locally compiled debug executable,
not the production Dockerfile or a Container image. Qualify the current owning
Dockerfile with the exact pinned engine source and a frozen commit tree; then
prove readiness and interrupted tool recovery using that artifact's runtime.
Do not borrow mutable sibling source, an older image or another owner's stack.

This is a local candidate artifact proof. It does not publish an image or release,
deploy the product, admit Host packages, validate Accounts or grant new authority.
Published image identity, real Container backend lifecycle, queues, Accounts,
remote storage, capacity and the real user journey remain separate requirements.

## Resource and isolation plan

The existing Docker daemon and existing `takosumi-remote` BuildKit cache are on
root disk. They and their stacks remain untouched. A temporary standalone
BuildKit uses only a private Unix socket, a private client configuration, HDD
cache/context/artifact paths inside this dedicated worktree, bounded build
parallelism and reduced scheduling priority. Use the already installed BuildKit
binary read-only; no global package/configuration change or service restart.
Archive exact Takos and engine Git trees, record source and artifact digests,
and supervise only this run's processes. Stop and reap this run's builder after
qualification; retain diagnostic artifacts on failure. Do not delete or move
existing Docker data, images, containers, caches or other worktrees.

Before heavy compilation, inspect active builds/gates and keep the usual
environment-wide two-heavy-job limit. Parent owns this task and qualification
code. The unchanged locked release build now declares `CARGO_BUILD_JOBS=2` as a
Dockerfile build argument, bounding Cargo's own scheduling on shared machines.
The builder's CPU affinity did not carry into the OCI sandbox (the probe observed
16 CPUs), so daemon affinity alone is not accepted as a Cargo job limit. This
argument is a production build-input change and receives independent review;
the release entrypoint is not invoked for this local proof.

## Preparation evidence

An independent inventory read the latest public release `v0.12.7`, source commit
`34340ad693b99a2dbc76d6ac60ed3003fb418ffd`. Its legacy
`takosumi-artifact.json` declares public image
`ghcr.io/tako0614/takos-agent@sha256:d737076cdab331b3065410606d0754fbb58b9ec25a8f0c0108c8e63991d38e7b`.
The 62-release inventory found no Takos v3 `takos-artifact.json` asset. These are
public descriptor claims, not independently read-back image bytes or runtime
proof. Current Dockerfile and wrapper source differ from that release; it is
not substituted for the candidate artifact.

The standalone BuildKit v0.31.0 starts with an OCI worker using sandbox process
mode and HDD overlayfs cache. Existing services and containers were not changed.
The same cached Rust builder image reports Rust/Cargo 1.94.0. A real RUN probe
confirms the Docker build argument is `CARGO_BUILD_JOBS=2`; its output and the
failed CPU-affinity assumption are retained at
`tmp/ga-container-qualification/{cargo-jobs-probe,cpu-probe}.log`.

## Frozen candidate artifact

The actual production Dockerfile build completed with exit 0 from frozen Takos
commit `f5207eb193d71f28a2fc1895e2a213a725bddf82` (tree
`e19dcf59f17fca4bc56d68882e1e2c52dacdca8a`) and engine pin
`c4c3c9f0ffc3956a917b8da38f97671dbd3aea2d` (tree
`94426e636f5a87429593372424f7c20167c41268`). The exact Takos source CI passed at
2026-09-30 22:01:54 UTC:
https://github.com/tako0614/takos/actions/runs/36782775728 . The build did not use
mutable sibling source or the production release entrypoint.

- OCI manifest: `sha256:4fba7740a515e902a67a623c9ff2ac4c4afd73e442a80abe4e47957e8d86f3e8`
- Config: `sha256:a4f7f33ec000718f5b75939d984f14a77fd96900bf0b99493ac7b04e4a7b0da6`
- OCI tar: `sha256:a06f85484bb0e414a16c519a8d8633d75ab33a77a62feba03bebd1af2f057d10`, 37,664,768 bytes
- Unpacked agent: `sha256:2b62e7d1b757232aedcb0daa486e642da33c3f7320b80f996f73ab2891ee7081`, 9,374,288 bytes

The OCI tar contains only layout metadata and regular digest-addressed blobs.
Every manifest/config/layer descriptor's physical size and SHA-256 was checked
against the layout and builder metadata. `candidate-identity.json` retains the
full ordered layer chain; `release-image-build.log` retains the locked release
build output. These files remain ignored in this worktree's HDD tmp.

Official umoci v0.6.0 was downloaded only into this private tmp, verified against
its official checksum and GitHub asset digest
`sha256:b51c267ec394499e42c6fde47f240b7b7dba57ea49df0b5acd304378b82a3b71`, and used
to unpack a separate preflight bundle. The generated config resolves image
`USER takos` to UID/GID 10001, command `/usr/local/bin/takos-agent` and `/app`;
the rootfs binary digest is above. Existing namespace mappings already cover
that UID/GID range; this did not create an authentication grant or system user.
The preflight did not execute the image. The temporary qualification BuildKit
was stopped and reaped after the build; other builders and Docker were untouched.

## Actual local OCI recovery

`scripts/prove-agent-container-recovery.ts` now reuses the unchanged Worker,
SQLite, ToolExecutor and lost-acknowledgement assertions through a typed runtime
adapter. The mandatory default binary CLI/proof remains in the product gate.
The OCI adapter verifies compressed layer digests and uncompressed diff IDs,
unpacks with the explicit operator-supplied verified tooling, retains UID/GID
10001 and mount/PID isolation, and uses host networking for loopback fixtures.
Each init is identified by PID plus `/proc` start ticks. Abort waits for prepare
and create/start, and only generated own IDs can be killed/deleted. Lease reclaim
waits for exact init absence and state removal; zombies and unknown identities
fail closed. Before each launch the rootfs executable hash is checked again.

Independent review identified preparation/cancellation ordering, partial-create
PID recovery, PID reuse/zombies, control-output capture and a result-scope
contradiction. Those were fixed and covered by focused fault tests. The first
actual OCI run successfully started the image and committed the real tool, then
failed during kill/reclaim because installed runc 1.4 returns JSON `null` for an
empty list. Native readback showed init PID 72679 gone and list exit 0 / `null`.
That failure is retained at `container-recovery-first-empty-list.log` and
`first-run-state-readback.json` below the qualification tmp. Red regressions
reproduced null-list rejection and stderr contamination of control JSON.
The final runner accepts only successful null/array list output, keeps malformed
output and remaining own IDs as failures, and retains stderr separately.
13 focused lifecycle/command tests pass; independent re-review is clear.

The second actual proof terminated with exit 0. Both image init processes served
readiness and used agent digest `2b62e7d1...` from the frozen image above. The
committed tool acknowledgement was held, old init 103782 was killed/reaped
before lease 7→8, and replacement init 104434 loaded the same checkpoint/loop ID.
Two tool attempts produced one artifact / one completed operation, two model
calls, usage 24/8/3, four durable messages and one completed event. Only the new
lease atomically completed and cleared the checkpoint; all four stale RPCs
returned 409 without durable SQL mutation. Both exact init identities and their
runc IDs were absent after cleanup. Result, source-file hashes and identity
chain are retained in `artifacts/candidate-identity.json`; raw output is
`container-recovery.log`, both under `tmp/ga-container-qualification`.

The build identity is supplied from this run's frozen Git archives; the image
does not embed a revision label, and the proof states that distinction. The
local OCI image is qualified with a substituted model/proxy-token/notifier
bridge. It was not published and does not qualify real Accounts, queue, SSE,
remote backends, monitoring/restore or Cloudflare/Host Container lifecycle.
The complete source gate and exact new-head CI remain separate requirements.

The additional source passed the complete Bun 1.3.14 gate with exit 0: 1,348
Bun tests / 229 files / 7,770 assertions, 20 OpenTofu tests, wrapper default 96
and mock-LLM 169 tests, all static/type/compile/Clippy/build phases and the actual
default Worker/SQLite/binary process recovery proof. Default proof output still
states its separate debug-process scope; it is not relabeled as OCI qualification.
Declared debt remains lint 112 / TypeScript 98, with zero undeclared diagnostics.
Raw output is `tmp/ga-container-qualification/full-check.log`.

The Dockerfile, Cargo.toml/lock, agent sources and engine-source pin remain
byte-identical to frozen image source `f5207eb19`; only the qualification scripts,
tests and documentation were added after that image build. The artifact above
continues to belong to that source commit. A later source head's CI result must
be checked independently, and it does not publish the local image.
