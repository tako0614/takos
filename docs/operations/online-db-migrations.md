# Operations: Online DB Migrations

> このページでわかること: Takos app DB の zero-downtime migration framework、
> expand / backfill / contract 手順、rollback procedure、release gate。

Takos の account / auth / profile / billing / OAuth / public API metadata は
`takos/app` が所有します。Takos product は Web/API primary surface として
運用し、CLI は DB migration の customer-facing control surface ではありませ
ん。Operator が migration を実行する場合も、正本は `takos/app` の migration
gate とこの runbook です。

## Gate

Run:

```bash
cd takos
deno task validate:migration-safety
```

This delegates to:

```bash
cd takos/app
deno task validate:migration-safety
```

The app-side validator treats migrations `0001` through `0062` as the legacy
baseline. New migrations starting at `0063` must include a safety class marker:

```sql
-- takos-migration-safety: expand
```

Allowed classes:

| Class | Use | Production rule |
| --- | --- | --- |
| `expand` | additive schema change | deploy before code reads/writes it |
| `backfill` | idempotent data copy / repair | chunked, observable, resumable |
| `contract` | remove old schema after traffic no longer uses it | explicit approval and rollback note |
| `emergency` | incident-only repair | incident commander approval |

## Zero-downtime Pattern

Use expand / migrate / contract:

1. Expand: add nullable/defaulted columns, additive tables, or additive indexes.
2. Deploy code that dual-writes or can read both old and new schema.
3. Backfill in bounded chunks. The backfill must be idempotent and resumable.
4. Switch reads to the new schema only after backfill evidence is green.
5. Keep dual-write for one observation window.
6. Contract: remove old schema only after rollback no longer needs it.

Do not combine expand and contract in one migration.

## Dangerous DDL

The app validator blocks new unmarked migrations with:

- `DROP TABLE`
- `DROP COLUMN`
- `ALTER TABLE ... RENAME TO`
- `ALTER TABLE ... RENAME COLUMN`
- `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`
- `CREATE UNIQUE INDEX` without `IF NOT EXISTS`

Dangerous DDL requires `contract` or `emergency` and both:

```sql
-- takos-migration-approval: <issue-or-runbook-link>
-- takos-migration-rollback: <forward-repair-or-restore-plan>
```

## Rollback Procedure

For `expand` and `backfill`:

1. Stop rollout and keep the expanded schema.
2. Roll application code back to the last version compatible with both shapes.
3. Leave additive columns/tables in place until the next patch window.
4. If a backfill caused bad data, run a forward repair migration or restore the
   affected rows from backup.

For `contract`:

1. Confirm the old code path is no longer deployed anywhere.
2. Confirm backups and restore drill evidence exist.
3. Run the contract migration in staging first.
4. If rollback is needed after contract, restore from backup or run the
   documented forward repair. Do not rely on ad hoc reverse SQL.

For `emergency`:

1. Incident commander approves the migration.
2. Preserve pre-change evidence.
3. Run only the narrow repair needed to mitigate the incident.
4. Open a follow-up task to convert the emergency fix into normal expand /
   backfill / contract state.

## Production Checklist

Before production:

- `deno task validate:migration-safety` is green.
- Migration has the correct safety class marker.
- Backfill has bounded batch size and idempotency.
- Code is backward compatible with the current production schema.
- Staging ran the same migration.
- Backup restore path is known.
- Rollback image / commit is known.

After production:

- Verify app/API health and billing/auth/profile smoke.
- Verify migration row exists in the migration ledger.
- Record runtime, row counts, and any skipped duplicate DDL.
- Keep expanded schema until the observation window is complete.

## Evidence

Public evidence:

- `validate:migration-safety` output.
- Pull request link.
- Release gate summary.

Private evidence:

- production migration run log
- backup snapshot id
- restore drill link
- provider account / D1 database id
