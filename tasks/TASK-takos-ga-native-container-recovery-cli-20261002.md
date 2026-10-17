# Takos GA: opt-in native Container recovery regression

Owner: dedicated Takos worktree. Scope: Takos only; common contracts remain with the main owner.
Status: permanent CLI implemented; actual local v2 trial, independent result review and required repository gate passed. Commit publication and current-head CI readback are separate evidence recorded in PR126 and the dedicated HDD handoff. GA remains open.

The first permanent CLI trial failed before Container start because its child incorrectly equated OCI config digest and Docker image ID. The local containerd-backed Docker returned the already verified manifest digest as its ID. All28 raw/source/review files remain sealed in ignored permanent-native-cli-integration/actual-cli-v1-failed-preserved.json (SHAb6a31544b09471036b053ea0845c9802dbb9724ccdc827925b534cea9768e05f). This remains an overall failure. The correction verifies only config-ID or manifest-ID, requires an exact manifest descriptor when present, otherwise an exact RepoDigest, and checks platform, execution config and rootfs diff IDs. The independent v2 source review admitted a fresh trial of the exact19 file hashes.

The actual permanent CLI v2 exited0/qualified=true in265.888831s (native258478ms; controller259.532102s). Its79 raw/source/review/protected files are sealed in actual-cli-v2-success-preserved.json (SHA82cfe6b65b95de202af63b353621869efaff2a9e96445601b2960af388976111). Parent COPY-only D1 verifies the106-entry ledger, completed lease8 Run/usage24/8/3, operation/artifact1, transcript4, terminal event1, first projection/successful ACK3 loss/real-due cold ACK4 retry, two idempotent meters/rollups and idle0. All1592 source files,705 bundle inputs and6 runtime identities matched; parent/child source maps and dirty HEAD0057448 identity were linked. Native two-Container destroy ACKs match both logical/physical witnesses; process group and fresh running agent/proxy are absent, preexisting IDs and both protected worktrees are preserved. Original79 raw byte hashes still match after querying only a new database copy. This is a working-tree local proof, separate from the pending committed-tree gate and CI.

Focused current tests:13 CLI/authority/process/source-continuity cases and14 OCI/Docker identity cases passed. Explicit ./paths avoid accidentally executing sealed old source snapshots; the existing portable runner already uses those explicit paths.

Independent permanent-native-cli-v2-result-review.md (SHAb241f3c71e9d7c76af1ec040074ce74df1dd08ab08d9b9d1e64ee49a97a36867) returned GO for this bounded local result. It independently rehashed all79 raw files twice without opening original SQLite; retained v1 failure remains28/28 exact. Stored checkpoint bytes match across fixture CAS, while the replacement load reports a different checkpoint SHA. The load witness establishes pending call, loop/session, prior usage and operation/result semantics, not byte-for-byte loaded representation identity. Only this documentary ledger changed after the actual v2 source snapshot; the19 reviewed implementation/docs/test files remain the executed bytes.

The first required gate attempt passed1676 portable tests/258 files/12371 assertions, then failed at agent-wrapper because the default sibling engine path does not exist beside this dedicated worktree (197.69s, exit1). This is not a green gate. The corrected run explicitly sets the supported TAKOS_AGENT_ENGINE_REPOSITORY to the canonical read-only engine repository; the wrapper archives its immutable c4c3c9f0ffc3956a917b8da38f97671dbd3aea2d Git object into this worktree's own temporary mirror, without using dirty engine source. Failed gate diagnostics remain in ignored permanent-native-cli-integration/gate/; corrected diagnostics use a new gate-v2/ directory.

The corrected complete bun run check exited0 in341.12s:1676 portable tests/258 files/12362 assertions; OpenTofu19+1 tests; pinned engine/wrapper Rust checks and compiled process recovery; native D1 HTTP/notifier proofs; Web and Worker builds. Existing declared type98/lint111 debt and undeclared0 are unchanged. Docker proof is separately qualified by the actual permanent CLI v2; it is not silently counted as portable CI. Final documentary status recording does not alter the19 executed implementation/docs/test files or705 Worker bundle inputs.

## Product boundary

Takos is software one person deploys for one instance owner. Private Workspaces and external participants remain distinct from that owner. This task verifies the existing authority paths without adding authentication grants, billing, release publication or deployment.

## Existing qualified evidence

HEAD0057448 / Draft PR126 / CI36928884870: required gate and1649 tests passed before this slice. The additional ignored native first-projector v3 controller/supervisor passed in241.713s. Its63-file seal SHA33d4db9b97f842284b614bcdbeb92c060e539a9deb97232a861f18094bbb5ffc preserves actual bytes. Parent COPY-only D1 qualification verifies all106 migrations, owner/private Workspace, operation/artifact1, transcript4, completed lease8 Run, genuine usage ACK3 loss, real-due ACK4 retry, canonical meters2 and idle dispatch. Independent actual-result review returned GO for this exact bounded local fixture composition (independent-native-first-projector-v3-result-review.md); all63 sealed file byte hashes were independently verified. V1 and v2 overall failed qualifications remain preserved; v2 passed only the inner composition before a late undefined expectedMeters check.

## Owning changes

- Add one explicit opt-in scripts/prove-agent-container-native-recovery.mjs entrypoint with a supervised native child and fresh owned evidence.
- Reuse the pure OCI verifier from the existing OCI/runc proof; retain that proof's distinct mandatory scope and checks.
- Extract the proven Worker fixture, request-local notifier/work trackers, checkpoint observer, and production-response observers into scripts/lib.
- Require explicit OCI layout/reference/source commit/manifest, locally preloaded agent and digest-pinned sidecar, pinned Bun, Docker-reachable callback and fresh output. No frozen HDD/image/date success defaults and no implicit image build/pull/load/tag.
- Read actual Wrangler compatibility and generated migrations dynamically. Retain original RPC budgets and320s/350s diagnostic bounds.
- Native Container.destroy is primary; only exact fresh same-Run/DO/image agent/proxy IDs may be stopped after fresh inspection. Preserve preexisting IDs and all failed evidence. Reap only the owned process group through Linux/Python pidfds after session/start-tick revalidation; no numeric group-signal fallback.
- Add meaningful portable image integrity, argument refusal and cleanup authority tests; Docker composition stays opt-in until its CI host and resources are owned.
- Document local versus hosted qualification, prerequisites, cleanup, artifacts and provenance limits.

## Sequence / owners

Parent owns integration, CLI/controller/supervisor, ledger/docs/package, exact ownership checks and all heavy verification. Draft OCI verifier/tests owner: native_cli_oci_verifier. Draft Worker factory/notifier owner: native_first_projector_fixture. Independent review owner: native_usage_first_projector_design. Each file has one editor; no other worktree changes.

The independently qualified prototype admits integration of generic files; run focused portable checks and one explicit actual native CLI proof. Complete required bun run check after source changes, commit/push the reviewed/tested bytes to PR126 and read back exact-head CI. A prototype or prepared component is never a successful permanent CLI test or new commit/CI result.

## Remaining GA dependencies and limitations

Local fixture-only lease7→8 CAS does not prove production stale cron/Queue reclaim or whole workerd restart. Registered owner OIDC/MFA/browser/mobile setup, published Container/Host lifecycle and whole-instance consistent SQL/KV/R2/Queue/alarm backup remain unverified in a real environment. Common edge.sql0110/readiness, Forms/Host/object/alarm/quota/concurrency and response-bound release provenance belong to the main owner. The retained image lacks whole-current-Worker embedded provenance; unchanged image inputs and explicit operator commit are separate evidence.
