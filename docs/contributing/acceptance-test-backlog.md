# Takos PaaS Acceptance Test Backlog

This backlog translates `../takos-paas/tests/conformance-tests.md` into
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
