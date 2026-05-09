# Takosumi Acceptance Test Backlog

This backlog translates `../takosumi/tests/conformance-tests.md` into
implementation test groups. It is intentionally severity ordered so multiple
agents can work independently.

## P0 Kernel safety

- Plan read set changed with `must-replan` rejects Apply.
- Plan read set changed with `must-revalidate` reruns validation before phase
  transition.
- Applied Deployment desired state is immutable.
- GroupHead advances atomically to an applied Deployment.
- Provider materialization failure does not mutate the applied Deployment.
- Approval subject digest changes invalidate approval.

## P1 First vertical slice

- Signed internal create/list space works.
- Signed internal create/list group works.
- Unsigned or tampered internal requests are rejected.
- `deploy plan` is non-mutating.
- `deploy apply` records desired activation state and advances GroupHead.
- Group summary distinguishes desired, serving, dependencies, and security
  state.
- Audit events are appended for space/group/plan/apply/activation.

## P2 Runtime/routing

- Runtime desired state can be materialized by no-op provider.
- Observed provider state never becomes canonical activation truth.
- RouteProjection is derived from route ownership and activation state.
- Router/process-role code cannot mutate deploy store directly.

## P3 Resources and migrations

- ResourceInstance survives rollback.
- ResourceBinding is represented in BindingSetRevision.
- Migration ledger records checksums and partial progress.
- Changed migration checksum blocks plan.
- Imported-bind-only resource cannot migrate.
- Restore is modeled as resource operation, not rollback.

## P4 Registry and trust

- Human package ref resolves to digest.
- Package digest is immutable execution truth.
- Trust revocation blocks new plans.
- Revoked active materialization marks group degraded rather than mutating
  activation.
- Provider support report blocks unsupported required feature.

## P5 Network security

- Internal service call without WorkloadIdentity is rejected.
- ServiceGrant is required for internal calls.
- RuntimeNetworkPolicy selectors are assignment-aware.
- Advisory egress where enforced is required blocks plan.

## P6 Publications/events/canary

- Publication outputs are never injected automatically.
- Secret publication output requires explicit injection and approval.
- Breaking producer change creates dependent consumer plan.
- Deployment-time publication binding cycle is blocked.
- Weighted assignments affect HTTP only.
- Queue/schedule/event defaults resolve through primaryAppReleaseId.
- Canary step creates a new rollout step Deployment.

## P-Phase 1.x Installable App Model backlog

Installable App Model (ROADMAP.md Part II Phase 1.1-1.7) の identity / installer
/ consumer / shared-cell / export / GitOps backlog。各 phase の acceptance gate
として追加する。

- **P-Phase 1.1.1**: Takosumi Accounts OIDC issuer JWT signing rotation
  (`takosumi.account.auth@v1` で resolve される issuer の signing key rotation
  で既存 token の verify が rotation window 内は通り、rotation 後は新 key
  で発行される)
- **P-Phase 1.1.2**: Pairwise OIDC subject derivation
  (`sub = pairwise(appId, installationId, takosumiUserId)` の一意性、app 間 user
  tracking 不能、installation 移動時の subject 切替)
- **P-Phase 1.2.1**: AppInstallation status state machine (`installing` →
  `ready` / `failed` / `suspended` / `exported` 遷移、 invalid transition の
  reject、audit event 出力)
- **P-Phase 1.3.1**: Install preview permission diff (Git URL + ref → app.yml
  parse → requested bindings / grants / estimated cost / publisher verification
  を preview として返す、approve なしで install しない)
- **P-Phase 1.4.1**: Takos legacy proxy mode termination (legacy `/oauth/*`
  route の deprecation window 終了後、Takos の OAuth provider / billing /
  publication API / legacy auth alias は public route として公開しない)。
  apps/api gateway の OAuth provider / billing proxy termination と apps/web
  の旧 OAuth provider / billing UI 撤去、apps/control direct OAuth provider /
  billing route guard、Takos grant publication cleanup は実装済み。残りは dead
  code / schema / contract cleanup。
- **P-Phase 1.5.1**: Shared-cell namespace isolation (shared runtime に bind
  された AppInstallation 同士で data namespace / OIDC client / billing / grants
  が交差しない)
- **P-Phase 1.6.1**: Export bundle integrity (`takosumi-git export` の bundle が
  installation.json / source.json / manifest.compiled.yml / data dump / bindings
  template を持ち、別 takosumi instance への import で同 source commit / digest
  を再現できる)
- **P-Phase 1.7.1**: GitOps deploy intent budget guard (Takos が
  `deploy-intent.gitops@v1` 経由で deploy intent を Git に commit する際、budget
  を超える resource は user approval なしで apply されない)
