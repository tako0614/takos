# Rollback SOP

> このページでわかること: production-impacting release の rollback 判断、
> deployment-id ベース rollback、one-click revert、staging rehearsal 証跡。

| Field | Value |
| --- | --- |
| Last reviewed | 2026-05-07 |
| Owner | Release owner / on-call owner |
| Scope | Takos managed service rollback |

## When to Roll Back

Start rollback assessment immediately when a release causes:

- authentication, billing-safe account access, Git hosting, deploy, or agent
  execution outage
- cross-tenant data exposure risk
- destructive migration or data integrity risk
- sustained SLO breach after mitigation
- failed production deploy with unknown serving state

Forward fixes are allowed only when rollback is impossible or clearly slower
than a small reviewed fix. Record the reviewer, risk, and fallback path.

## Fast Path

1. Freeze further deploys for the affected product root.
2. Identify the current deployment id, previous healthy deployment id, commit
   SHA, image digest, Helm values, and Terraform summary.
3. Confirm the previous artifact is retained and compatible with current schema.
4. Execute the owning rollback path.
5. Verify Web / API login, Git hosting, deploy status, and affected customer
   workflow.
6. Announce mitigation status using the incident response runbook if customer
   impact exists.
7. Record evidence: operator, timestamp, command, before / after deployment id,
   smoke result, and follow-up owner.

## Rollback Paths

| Surface | Primary rollback | Evidence |
| --- | --- | --- |
| Takos Web / API on Cloudflare | `takos-private` service deploy to previous version / worker version rollback | Cloudflare version id, route, smoke URL |
| Takos Helm distribution | re-apply previous generated values and image digests | Helm release revision, values artifact |
| Takos Terraform distribution | revert infra commit and run plan/apply through operator gate | Terraform plan summary, state backup |
| Takosumi deployment group | `/api/public/v1/groups/:groupId/rollback` or deployment `mode: "rollback"` | group id, previous deployment id |
| GitHub source release | one-click revert PR or revert commit | revert PR URL, commit SHA |
| DB migration | expand/backfill rollback note or restore plan from migration safety doc | migration id, backup / forward-repair plan |

The rollback command must target an explicit deployment id, version id, image
digest, tag, or commit SHA. Do not rely on mutable tags such as `latest`.

## One-click Revert

For code-only regressions:

1. Use the hosting provider's revert button or create `git revert <sha>`.
2. Keep the revert PR minimal and link the incident / release record.
3. Run required checks for the affected product root.
4. Promote to staging first unless an active SEV requires emergency production
   forward-fix.
5. Keep the original release branch intact for root-cause analysis.

## Verification

Rollback is not complete until:

- production route serves the expected previous version
- health checks and request logs show recovery
- the release owner confirms affected user workflow recovery
- rollback metrics and deployment audit event are present
- customer communication status is decided

## Staging Rehearsal

Phase E GA readiness requires one staging rollback rehearsal. The evidence must
include:

- staging release candidate commit SHA
- previous healthy deployment id
- rollback command or UI action
- smoke result after rollback
- elapsed time from decision to recovery
- follow-up items for automation or documentation gaps
