# Takos GA: exact local Container artifact qualification

Date: 2026-09-30 UTC
Status: preparing independent local build and recovery proof
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
`tmp/ga-container-qualification/{cargo-jobs-probe,cpu-probe}.log`. The actual
release image build and Container recovery proof remain pending at this point.
