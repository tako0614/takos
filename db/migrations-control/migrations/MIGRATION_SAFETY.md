# Migration Safety Contract

This file defines the Takos app database migration safety gate.

## Baseline

Migrations `0001` through `0062` are grandfathered pre-gate migrations. They
were written before the Phase E online migration gate and can include
destructive repair operations. Do not edit already-applied migration files; add
a new forward migration instead.

The first guarded migration prefix is `0063`.

## Naming and ordering

A migration's file name is its identity in the applied ledger. The Worker
records `_takos_opentofu_migrations` by name, and adopts the `d1_migrations`
and `_takos_self_host_migrations` ledgers by name too. **Renaming an applied
migration makes every live database apply it a second time**, so a mistake in
the sequence is recorded rather than corrected.

- A file name is `NNNN_lower_snake_case.sql` with exactly four digits.
- Two migrations may not share a prefix.
- The sequence may not skip a number.
- The applied order is the file-name order, which for four-digit zero-padded
  prefixes is the same as the numeric order. The gate refuses any directory
  where those two orders differ.

The directory already contains two shared prefixes (`0043`, `0055`) and a gap
(`0100`-`0105`) from before this rule. Both are declared, with the reason they
cannot be corrected, in [`ORDERING.json`](./ORDERING.json). The gate refuses a
new one, and refuses an entry there that no longer describes the directory.

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

## Deferred contract cleanup

- `mobile_push_registrations` is intentionally preserved during the
  notification-pusher cutover. Database migrations run before the replacement
  Worker artifact is uploaded, so dropping the table in the cutover release
  would break the still-serving Worker during rollout. Add a new, later
  `contract` migration only after the replacement Worker is active in every
  environment, the rollback window has expired, and a restore path has been
  verified. The replacement code does not map, read, or write this table;
  retaining it keeps overlapping or rolled-back Workers compatible without
  affecting the new notification-pusher path. Full database resets continue to
  remove it through `db/drop_all.sql`. Migration `0109` also recreates the
  legacy table and indexes idempotently as a forward repair for any environment
  that applied the prematurely ordered local `0102` contract migration; it
  cannot restore registration rows that were already deleted, but it restores
  the schema required by an old-Worker rollback.
