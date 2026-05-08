# Operations: Backup and Restore Drills

> このページでわかること: Takos operated environments の backup / restore drill
> cadence、月次 staging restore、四半期 production simulation、証跡、失敗時の
> escalation 基準。

Takosumi kernel の logical backup / restore protocol は
`takosumi/docs/reference/backup-restore.md` が正本です。このページは Takos
operator がその protocol をどの頻度で検証し、どの evidence を残すかを定義
します。

## Scope

**Backup/Restore 3 layer**:

1. **Takosumi Account level** (Takosumi Accounts 所有): identity, billing,
   AppInstallation ledger
2. **Takos product level** (Takos 所有): app-local profile, chat / memory /
   files
3. **Runtime / kernel level** (takosumi 所有): deployment records, compiled
   manifests, runtime-agent work queue

各 layer は **独立した backup runbook** を持ち、整合性 restore は cross-layer の
sequencing で行います (account level → product level → kernel level の順)。

対象データ:

- Takos app-local profile / chat / memory / files (Takos product level)
- Takos Git repositories / refs / object metadata (Takos product level)
- Takosumi deployment records / WAL / audit chain / provider operation state
  (runtime / kernel level)
- runtime-agent work queue and terminal projections (runtime / kernel level)
- default app metadata required to reattach customer routes
- secret metadata and encrypted envelopes

Takosumi Account level の identity / billing / AppInstallation ledger は
Takosumi Accounts service の backup runbook が正本です。本 runbook は Takos
product level と runtime / kernel level の drill cadence を扱います。

対象外:

- customer export / deletion workflow
- provider-native backup product selection
- commercial SLA credit calculation

Customer-facing export は portability surface であり、operator backup の代替では
ありません。

## Cadence

| Drill                         | Frequency      | Environment                                   | Required evidence                                                              | Owner                              |
| ----------------------------- | -------------- | --------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------- |
| Staging logical restore       | monthly        | staging                                       | restore transcript, audit chain verification, smoke result, RTO / RPO sample   | platform on-call owner             |
| Production restore simulation | quarterly      | production shadow / isolated recovery account | dry-run transcript, latest backup freshness, restore plan review, access check | platform owner + secondary on-call |
| Backup inventory audit        | monthly        | staging + production                          | backup age, chain head, encryption key availability, retention window          | storage owner                      |
| Emergency restore tabletop    | twice per year | staging or meeting room                       | timeline, decision log, role assignment, runbook gaps                          | incident commander pool            |

If a monthly staging restore is skipped, the next production release promotion
requires explicit platform owner approval.

## Monthly Staging Restore

Goal: prove a real backup can restore a staging environment without using
production customer data.

Procedure:

1. Pick the latest staging backup that is at least 30 minutes old.
2. Record:
   - backup id / timestamp
   - source environment
   - schema version
   - audit chain head
   - encrypted secret partition id
3. Create an isolated restore target. Do not overwrite active staging.
4. Run logical restore according to `takosumi/docs/reference/backup-restore.md`.
5. Verify:
   - restore completes without skipped critical records
   - audit chain verifies from genesis to restored head
   - deployment records list successfully
   - one known staging app route responds
   - one deploy plan can be resolved without applying
   - runtime-agent queue is empty or intentionally paused
6. Record measured RTO and backup age as RPO sample.
7. Destroy the isolated restore target after evidence is attached.

Pass condition:

- restore completes
- audit chain verifies
- smoke checks pass
- RTO sample is below the current DR target or an action item is filed

## Quarterly Production Simulation

Goal: verify production backups, access, keys, and restore instructions without
restoring into live production.

Allowed actions:

- read latest backup metadata
- verify backup object existence / retention
- verify key access through approved break-glass path
- run restore tool in dry-run / validate-only mode
- restore a sanitized sample into isolated recovery account if approved

Forbidden actions:

- overwrite live production storage
- replay production writes into staging
- expose customer data in public docs, tickets, or screenshots
- bypass incident commander approval for break-glass credential access

Production simulation must include primary and secondary on-call. If break-glass
access is exercised, it must create an audit event and a follow-up review item.

## Evidence Record

Each drill produces a private evidence record. Public docs may only summarize
that the drill occurred.

Required fields:

```text
date:
drill type:
environment:
operator:
backup id:
backup timestamp:
schema version:
audit chain head:
restore target:
RTO sample:
RPO sample:
smoke checks:
result: pass | fail
follow-up actions:
```

Takos-operated private environments store evidence in `takos-private` run logs
or the approved incident / compliance system. Do not commit customer
identifiers, provider account ids, raw backup object names, or secret partition
material to public docs.

## Failure Handling

Open a SEV-2 incident when:

- latest usable backup is older than the declared RPO target
- restore fails before audit chain verification
- required restore key is unavailable
- backup inventory is missing for an entire environment
- monthly staging drill is missed twice in a row

Escalate to SEV-1 when:

- production data loss is suspected
- no usable production backup is available
- restore tooling corrupts the recovery target
- secret partition cannot be read with approved keys

## Follow-up Rules

Every failed drill must produce action items with owner and due date. Critical
backup / key availability issues block production release promotion until closed
or explicitly waived by platform owner and incident commander pool.

Recurring failures require a postmortem using
[Incident Response](/operations/incident-response), even if no customer impact
occurred.
