# Takos GA: native cron and Queue Run recovery

Owner: dedicated Takos worktree. Scope: portable regression evidence for existing Takos handlers. Status: earlier focused native runs passed, including the lint-repaired caller (1 test, 64 assertions, 65.30s). The final candidate additionally checks complete event outcomes and cron duplicate dispatch; its focused test, independent source review, required gate, commit and exact-head CI remain separate stages.

The previous opt-in Container trial passed its local checkpoint/tool/usage composition, but replaced lease7 with lease8 through a fixture CAS. That evidence does not exercise production stale selection, native Queue delivery, the actual claim or the prior-operation fence. This slice adds a separate native D1/Queue regression before composing those handlers with physical Containers.

## Boundary and implementation

Use the canonical `src/worker/index.ts` scheduled and Queue entrypoints, the installed Miniflare/workerd runtime and all embedded production migrations. Native Queue producers and consumers carry the recovery message. Only the executor transport is synthetic: its receipt establishes which already claimed Run was handed off, and does not establish Container admission or execution.

The fixture has one configured OIDC owner and a private Workspace. Multiple private Workspaces and external participants remain product features. Do not add authentication grants, billing, live targets or shared multi-owner SaaS behavior. Do not change common Takoserver/Forms/Host contracts, persisted schema or production recovery policy.

Current Queue claim atomically sets running status, heartbeat, started time and a new service/lease. A nullable schema field alone is not evidence of a current NULL-heartbeat producer. No fallback policy is added for that unproven hypothesis. Stale eligibility is an explicit old timestamp in a new fixture; a real five-minute failure-detection interval remains separate evidence.

## Acceptance

- Actual scheduled entrypoint requeues a stale running Run and native Queue delivery claims lease7 to lease8 with its generated service identity. Preserve complete event outcomes and require success; fresh/terminal control delivery must explicitly ACK both messages without retry.
- Fresh running and terminal Runs remain untouched. Duplicate delivery causes neither a second dispatch nor a second lease increment.
- Persisted model, checkpoint, cumulative usage, Workspace, requester and completed operation result survive takeover. Prior pending operations become uncertain before executor transport.
- Source, bundle inputs, compatibility settings, migration ledger and runtime identity are captured; successful cleanup is required. Failed diagnostics are retained in fresh owning-worktree state.
- An isolated Node child prevents unrelated Bun mocks from substituting Miniflare. Inner and outer deadlines are bounded, without increasing previous Container budgets.
- Focused native tests, independent source review, the required `bun run check`, reviewed commit and exact-head PR126 CI are distinct stages. Prepared tests or a stub receipt never become a successful Container or hosted result.

The implementation worker owns only the three new fixture/probe/test files. Parent owns integration, this ledger, documentation, required gate and publication. An independent reviewer owns ignored notes only. Existing original Takos chat/UI changes and the uncommitted engine candidate remain read-only and are not duplicated.

Early fixture failures remain in fresh ignored directories, including an invalid seed column, incorrect Queue event serialization, missing owner bindings and schema convergence interrupted by overlapping process sampling. The schema claim was released on pending; no lease/budget policy was changed. Serial ownership sampling and the correct configured-owner binding let the existing default migration path reach the full manifest within two admissions. Successful native result bytes are retained separately from failed outer harnesses. The final caller retains bounded raw logs, verifies one receipt against the complete result and requires process cleanup; earlier domain success alone cannot qualify that caller or a new CI run.

## Remaining dependencies

Real Container recovery through canonical cron/Queue, whole-workerd restart, released-image/Host lifecycle, registered-owner OIDC/MFA/browser/mobile, consistent whole-instance backup/restore and populated-state reconciliation remain unverified. Main owns common readiness/edge.sql/Forms/Host/object/alarm/quota/concurrency and response-bound release provenance. No merge, deployment, publication or deletion of existing data is authorized by this task.

The Fetcher event result shape is checked against the [Cloudflare workerd experimental types](https://github.com/cloudflare/workerd/blob/main/types/generated-snapshot/experimental/index.ts): scheduled and Queue events return an outcome object, rather than a void success signal. Full result bytes are retained and asserted; transport effects alone do not qualify a failed event.
