# Legal: SOC 2 Readiness Checklist

> このページでわかること: Takos の SOC 2 readiness scope、control owners、
> evidence targets、audit preparation backlog。

This checklist is a readiness artifact, not an audit report. Takos does not
claim SOC 2 compliance until a qualified auditor completes the engagement.

## Scope

Initial SOC 2 readiness scope:

| Area                    | In scope                                                        | Owner            |
| ----------------------- | --------------------------------------------------------------- | ---------------- |
| Application security    | `takos-app`, `takos-git`, `takos-agent`, Takosumi API boundary  | service owners   |
| Infrastructure security | managed cloud / Kubernetes / Cloudflare distribution profiles   | operator         |
| Change management       | PR review, release gate, staging promotion, rollback            | release owner    |
| Incident response       | SEV policy, incident runbook, postmortem evidence               | on-call owner    |
| Availability            | SLOs, capacity planning, backup / restore, DR plan              | operations owner |
| Confidentiality         | secret rotation, access control, private deploy boundary        | security owner   |
| Processing integrity    | deploy audit trail, migration safety, usage / billing integrity | product owner    |

Out of scope for the first readiness pass:

- formal auditor engagement
- Type II observation period
- customer-specific bridge letters
- regulated workloads such as HIPAA / PCI unless separately contracted

## Trust Services Criteria Mapping

| Criteria                 | Current evidence target                                    | Gap                                  |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------ |
| CC1 Control environment  | owner map, code of conduct, operating policies             | formal security ownership roster     |
| CC2 Communication        | docs site, incident updates, support channel               | customer-facing status page evidence |
| CC3 Risk assessment      | ROADMAP risks, patch management, threat model backlog      | recurring risk review log            |
| CC4 Monitoring           | release gate, observability stack, security audit workflow | alert review evidence                |
| CC5 Control activities   | CI gates, migration safety, branch protection policy       | branch protection export             |
| CC6 Logical access       | OAuth/PAT verification, internal service signatures        | access review cadence                |
| CC7 System operations    | on-call, SEV, backup/restore, DR                           | executed staging drills              |
| CC8 Change management    | PR review, release gate, migration gate                    | production sign-off evidence         |
| CC9 Vendor risk          | sub-processor list, DPA draft                              | vendor review records                |
| A1 Availability          | capacity plan, SLOs, backup/restore, DR                    | sustained SLO reporting              |
| C1 Confidentiality       | secret rotation, private deploy boundary, audit redaction  | data classification register         |
| PI1 Processing integrity | billing usage rollups, deploy audit, migration safety      | reconciliation evidence              |

## Readiness Checklist

### Governance

- Security owner and deputy are named.
- Data protection owner is named.
- Service owner map exists for every product root.
- Policy exception process exists with owner and expiry.
- Quarterly risk review meeting is scheduled.
- Installation ledger and Takosumi Account billing model are listed in the
  data protection owner audit checklist (Installable App Model: identity /
  billing owner = the operator-selected account plane, managed example:
  takosumi-cloud の Takosumi Accounts; Installation 台帳 = ownership
  primitive).

### Access Control

- Production access requires named account identity.
- Shared credentials are prohibited outside break-glass.
- Break-glass access is logged and reviewed.
- OAuth / PAT / internal service credentials have revocation paths.
- Access review cadence is documented.

### Change Management

- PR review is required for production code.
- Release gate is required before promotion.
- Migration safety validator gates app DB changes.
- Patch management validator gates base image policy.
- Rollback SOP exists and is rehearsed in staging.

### Operations

- On-call and SEV policy exists.
- Incident response runbook exists.
- Backup / restore drill cadence exists.
- Disaster recovery plan exists.
- Capacity planning baseline exists.
- Cost attribution dashboard exists.

### Security Monitoring

- Weekly security audit workflow runs.
- Trivy HIGH / CRITICAL findings block the patch workflow.
- Observability dashboard artifacts are versioned.
- Request correlation and trace IDs exist for Takosumi API paths.
- Security disclosure intake path is published.

### Data Protection

- Privacy Policy / Terms / DPA legal review is tracked by the operator.
- Data subject export/delete handler exists.
- Sub-processor list is published.
- Data residency policy is published.
- Audit retention and redaction policy are documented.

### Vendor Management

- Stripe, Cloudflare, AWS, GCP, OpenAI, and hosting providers are listed.
- Sub-processor list is published before GA.
- Vendor purpose and data category are documented.
- Vendor security / privacy review evidence is stored privately.
- New vendor onboarding requires owner approval.

## Evidence Register

| Evidence          | Owning docs                                                                                                                                                | Private evidence          |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| On-call policy    | [`takos-private/docs/operations/oncall.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/oncall.md)                               | incident paging config    |
| Incident response | [`takos-private/docs/operations/incident-response.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/incident-response.md)         | incident records          |
| Backup drills     | [`takos-private/docs/operations/backup-restore-drills.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/backup-restore-drills.md) | restore logs              |
| DR plan           | [`takos-private/docs/operations/disaster-recovery.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/disaster-recovery.md)         | failover run logs         |
| Capacity plan     | [`takos-private/docs/operations/capacity.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/capacity.md)                           | traffic reports           |
| Cost monitoring   | [`takos-private/docs/operations/cost-monitoring.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/cost-monitoring.md)             | billing reconciliation    |
| Patch management  | [`takos-private/docs/operations/patch-management.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/patch-management.md)           | vulnerability exceptions  |
| Migration safety  | [`takos-private/docs/operations/online-db-migrations.md`](https://github.com/tako0614/takos-private/blob/master/docs/operations/online-db-migrations.md)   | production migration logs |
| Release gate      | [`docs/quality/release-gate.md`](https://github.com/tako0614/takos-ecosystem/blob/master/docs/quality/release-gate.md)                                     | CI run artifacts          |

## Audit Preparation Backlog

- Store legal approval evidence for Privacy Policy, Terms, DPA, and
  sub-processor list.
- Store data subject access / export / deletion request evidence.
- Store data residency enforcement evidence for managed production tenants.
- Store security disclosure mailbox and encrypted-exchange evidence.
- Export branch protection / required review settings for each repo.
- Run one SEV-1 staging simulation and attach evidence.
- Run one rollback SOP staging rehearsal and attach evidence.
- Record monthly access review evidence.
- Record vendor review evidence for each sub-processor.
