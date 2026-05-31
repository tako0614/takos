# Migration Safety Contract

This file defines the Takos app database migration safety gate.

## Baseline

Migrations `0001` through `0062` are grandfathered pre-gate migrations. They
were written before the Phase E online migration gate and can include
destructive repair operations. Do not edit already-applied migration files; add
a new forward migration instead.

The first guarded migration prefix is `0063`.

## Required marker

Every migration with prefix `0063` or later must include exactly one safety
marker near the top:

```sql
-- takos-migration-safety: expand
```

Allowed classes:

| Class       | Purpose                                                           | Default deploy rule                          |
| ----------- | ----------------------------------------------------------------- | -------------------------------------------- |
| `expand`    | Add nullable/defaulted columns, additive tables, additive indexes | can deploy before code                       |
| `backfill`  | Idempotent data copy or shape repair                              | run after expand, before reads switch        |
| `contract`  | Remove old columns/tables/indexes after code no longer uses them  | requires explicit rollback note              |
| `emergency` | Incident-only fix                                                 | requires explicit approval and rollback note |

## Dangerous DDL

The validator treats these as dangerous:

- `DROP TABLE`
- `DROP COLUMN`
- `ALTER TABLE ... RENAME TO`
- `ALTER TABLE ... RENAME COLUMN`
- `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`
- `CREATE UNIQUE INDEX` without `IF NOT EXISTS`

Dangerous DDL is allowed only in `contract` or `emergency` migrations and must
include:

```sql
-- takos-migration-approval: <issue-or-runbook-link>
-- takos-migration-rollback: <forward-repair-or-restore-plan>
```

## Rollback rule

Takos app migrations are forward-only at the DDL layer. Rollback means:

1. Stop writes or route traffic away when needed.
2. Roll application code back to a version compatible with both old and new
   schema during expand/backfill.
3. For contract/emergency migrations, run the documented forward repair or
   restore from backup according to the operator runbook.

Do not rely on ad hoc reverse SQL for production rollback.
