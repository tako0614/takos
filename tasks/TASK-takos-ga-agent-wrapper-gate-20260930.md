# Takos GA: pinned agent wrapper qualification

Date: 2026-09-30 UTC
Status: source_verified / runtime qualification pending
Owner: Takos dedicated session
Required for: `production_or_release`
Grants mutation authority: false
Repository mutation scope: `takos` only
Base: `a89bc5267baedecea9ddf8ba9ce98e823ba15564`

## Defect and scope

The required product gate and CI install Rust but never compile or test the
Rust service shipped in the agent image. The CI engine checkout follows its
mutable default branch, whereas the distribution builder uses
`containers/agent/engine-source.json` with exact engine commit
`c4c3c9f0ffc3956a917b8da38f97671dbd3aea2d`.

Add wrapper formatting, compilation, lint, default/mock-LLM tests and executable
build to the owning gate. Copy current wrapper source into an ignored context
and archive the exact locally provisioned engine object; do not consume dirty
sibling files. Cargo dependencies are prepared separately using the lockfile;
the gate is offline and cannot fetch or skip a missing engine pin. Pin the
compiler and image builder to Rust 1.94.0. This task changes source/CI validation,
not production state, authentication, billing, shared contracts or permissions.

## Inherited candidate and ownership

The inherited engine diff at base `0a1216b` is still the same 62-line regression
test candidate with SHA-256
`83978e18d6df79d7b0632c9bf52748a2ea5e69884771fc514024216cde32f0e1`.
It was archived into this worktree's ignored
`tmp/agent-qualification.Qt6HBz/takos-agent-engine` and patched there.
The external candidate worktree and original UI work remain unchanged.

Its complete `bun run check` now exits 0: formatting, Clippy with warnings as
errors, rustdoc, all-target/all-feature and default-feature compilation, MSRV
Rust 1.85.0 compilation, 212 tests (0 failed/ignored) and all-target build.
The default compiler was Rust 1.97.1; Bun was 1.4.0. This is candidate source
qualification, not a library commit/publication or wrapper consumer proof.
Log: ignored `tmp/agent-qualification.Qt6HBz/engine-check.log`.

## Acceptance and verification

- Missing or mismatched source pins and toolchain/image disagreement fail early.
- Dirty/untracked engine files cannot enter the compiled context.
- Cargo uses the exact compiler, lockfile and offline mode in the gate.
- Default tests, mock-LLM tests and the production executable build all run;
  a compile/test failure stops the gate without proceeding to later phases.
- Real wrapper tests use checkpoints emitted by the pinned engine. Replacement
  at `execute_tools` retries the same operation key and reads a fake durable
  ledger result: two RPC attempts, one physical operation, one loop identity,
  correlated transcript and cumulative usage, with only the new lease completing.
- Replacement at a running model checkpoint safe-stops without another model or
  tool call and preserves the transcript/usage in failed atomic completion.
  This intentionally follows the engine's `RecoveryUnsafe` contract.
- Complete owning `bun run check` and independent review before handoff.

## Verified results

The expanded `bun run check` exits 0 under CI-pinned Bun 1.3.14 and wrapper
Rust 1.94.0. It runs 1,322 Bun tests across 227 files (6,574 assertions),
20 OpenTofu mock-plan tests, all existing format/drift/schema/static/type/
architecture/build phases and every new wrapper phase. Default wrapper tests
pass 96/96; the mock-LLM configuration passes 66 library + 96 executable +
7 integration tests. Formatting, all-target/all-feature compilation, default
and all-feature Clippy with warnings as errors and the production executable
build pass. Existing debt remains 112 lint / 98 TypeScript diagnostics, with
zero undeclared findings. Log: ignored `tmp/ga-sse-recovery/expanded-check.log`.

The gate's six focused tests use real Git archives and an injected Cargo
runner to prove pin isolation, early refusal, failure propagation, phase
selection, locked prepare, provider-key scrubbing, disabled toolchain auto
installation and bounded generated-context cleanup while preserving the
target cache. A successful real gate removes its temporary source context.
`bun run docs:build` also exits 0 under Bun 1.3.14.

Independent Sol review found and verified fixes for two fixture issues:
concurrent request-log entries could replace the inspected RPC body, and a
child harness could silently select zero tests or wait indefinitely. Each
handler now keeps its own payload; child proofs require the exact one passing
test and kill/reap a stalled child after 45 seconds. No material P1/P2 remains
in the reviewed change. The review did not itself run the full gate.

Previous PR head `a89bc5267baedecea9ddf8ba9ce98e823ba15564` has a successful
remote CI run. That run does not qualify this expanded Rust gate; current-head
CI must be read back after push. No release artifact or image was published.

## Remaining boundary

The localhost RPC contract fixture is not an actual deployed Worker or a real
Accounts login. This gate does not build/publish a Container image or deploy.
Full Worker-plus-wrapper interruption E2E, live exact Host Form/Binding admission,
container health/lease/restart, SSE capacity, monitoring and restore remain
separate GA evidence. No new environment, billing, rights or destructive data
operation is authorized by this task.
