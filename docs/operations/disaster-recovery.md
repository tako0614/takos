# Operations: Disaster Recovery Plan

> このページでわかること: Takos operated environments の disaster recovery
> target、RTO / RPO、multi-region failover 手順、復旧後の検証と復帰条件。

この DR plan は [Backup and Restore Drills](/operations/backup-restore-drills)
と [Incident Response](/operations/incident-response) を実行前提にします。
Takosumi kernel の logical restore protocol は
`takosumi/docs/reference/backup-restore.md` が正本です。

## Targets

| Target | Value | Meaning |
| --- | --- | --- |
| RTO | <= 4 hours | SEV-1 DR 宣言から customer-facing critical path が復旧するまで |
| RPO | <= 15 minutes | 復旧先で許容する committed control-plane data loss window |
| Detection | <= 5 minutes | production-wide outage を operator が ack するまで |
| Customer update | <= 15 minutes | SEV-1 宣言後の初回 customer/status update |

RTO / RPO は target です。四半期 DR simulation で実測し、target を満たせない場合
は release promotion blocker として扱います。

## DR Modes

| Mode | Use when | Data source | Risk |
| --- | --- | --- | --- |
| In-region recovery | isolated service / storage failure | same-region replica / backup | fastest, same-region dependency risk |
| Cross-region failover | region-wide outage or provider impairment | latest verified cross-region backup / replica | DNS / route propagation and provider parity risk |
| Provider failover | cloud provider incident | distribution profile for alternate target | highest compatibility and data freshness risk |

Default strategy is active-passive cross-region recovery. Active-active is not
assumed by this plan unless a specific distribution profile documents it.

## DR Declaration

Declare DR when one of these is true:

- primary region is unavailable and no recovery path exists within 30 minutes
- control-plane storage is unavailable or corrupt
- no safe in-place rollback exists for a production-wide outage
- security incident requires isolating the primary environment
- provider outage prevents deploy / auth / git access across the primary region

DR declaration requires incident commander approval. If the incident commander is
unavailable, primary and secondary on-call can jointly declare DR and record the
reason in the incident channel.

## Pre-flight Checklist

Before failover:

1. Freeze production deploys and background mutation jobs.
2. Confirm latest usable backup / replica timestamp.
3. Confirm RPO estimate is <= 15 minutes or explicitly accept customer impact.
4. Verify access to:
   - recovery account / region
   - encrypted secret partition key
   - DNS / routing control
   - image / artifact registry
   - observability dashboard for recovery target
5. Assign owners:
   - restore owner
   - routing owner
   - verification owner
   - customer communications owner
6. Record go / no-go decision in the incident timeline.

## Cross-region Failover Procedure

1. Provision or select recovery target.
   - Use the current distribution profile for the target region.
   - Do not mutate live primary storage while restore is in progress.
2. Restore control-plane data.
   - Follow `takosumi/docs/reference/backup-restore.md`.
   - Verify audit chain before enabling writes.
   - Verify secret partition availability without exposing secret values.
3. Reattach runtime services.
   - Start `takos-app`, `takos-git`, `takos-agent`, and Takosumi service set.
   - Confirm health endpoints are green.
   - Confirm runtime-agent pools enroll against the recovery target.
4. Validate customer-facing critical paths.
   - login / session validation
   - repository read
   - deploy plan resolve
   - one known default app route
   - billing/profile read path
5. Shift routing.
   - Lower TTL if not already low.
   - Point customer-facing hostnames to recovery target.
   - Watch 5xx / latency / auth error rate.
6. Enter monitoring state.
   - Keep deploy freeze until two observation windows are green.
   - Send customer update with recovered services and known residual risk.

## Provider Failover Notes

Provider failover is not a routine rollback. Before moving from one cloud target
to another:

- confirm distribution profile parity
- confirm required provider plugins are production-ready
- verify artifact registry / image digest availability
- confirm DNS ownership and TLS issuance path
- confirm data resources have provider-supported restore semantics

If provider failover cannot preserve data freshness within RPO, customer
communication must state the known data window and expected reconciliation path.

## Return to Primary

Do not return traffic to primary until:

- root cause is fixed or isolated
- primary data is reconciled from recovery target
- audit chain and deployment records are consistent
- customer-facing critical paths pass smoke checks
- incident commander approves cutback

Cutback is treated as a separate change window. If recovery target has accepted
writes, primary must be restored from recovery target or formally abandoned.

## Verification

Recovery is not complete until all are true:

- HTTP 5xx / latency are back within SLO
- deploy plan resolve succeeds
- Git read path succeeds
- runtime-agent heartbeats are healthy
- audit chain verifies
- backup age / RPO sample is recorded
- customer update is sent
- follow-up actions are filed

## Simulation Cadence

At least quarterly, run a production DR simulation without live traffic shift.
At least twice per year, run a tabletop that includes incident commander,
primary on-call, secondary on-call, routing owner, storage owner, and customer
communications owner.

Simulation evidence follows the same private evidence handling rules as
[Backup and Restore Drills](/operations/backup-restore-drills).
