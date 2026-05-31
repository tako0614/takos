# Takosumi Integration Status

## Completed

### Phase A: Best-effort dual-write

- `createTakosumiInstallation()` calls `POST /v1/installations` on Space
  creation.

### Phase B: Database migration

- Migration `0078_accounts_takosumi_installation_id.sql` adds nullable
  `takosumi_installation_id TEXT` column to `accounts` table.
- Drizzle schema updated in `schema-accounts.ts`.

### Phase C: Read path

- `loadSpaceById` returns `takosumiInstallationId` via Drizzle select-star.
- `accountToWorkspace` populates `Space.takosumi_installation_id` from the DB
  column.

### Phase D: Write path (blocking + persist)

- Space creation awaits `createTakosumiInstallation()` and persists the returned
  `installationId` to the `accounts` row.
- Space deletion calls `deleteTakosumiInstallation()` before removing the DB
  row.
- Env vars unset: dual-write is silently skipped (backward compatible).
- API failure: Space creation succeeds with `takosumi_installation_id = NULL`
  (best-effort-with-backfill).

## Future Work

### Per-Installation OIDC

Takosumi Accounts already provisions per-Installation OIDC clients
(`findOidcClientForInstallation()` in `d1-store.ts`). Takos currently uses
global `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` env vars.
Refactoring `oidc.ts` (675 lines) to query per-Installation config from Accounts
is a large change affecting auth flow, session management, and redirect URI
handling.

### Billing export

App-local metering exists in `schema-app-usage.ts`. Old billing routes return
410 Gone. `.takosumi.yml` declares
`listen.billing.path: billing.primary.default` (optional). No export of usage
data to Takosumi Accounts billing surfaces exists yet.

### Phase E: Blocking failure mode

Space creation should fail if Takosumi Installation creation fails. Requires
circuit breaker pattern, retry with backoff, and integration tests against
staging Accounts.

### Existing Space backfill

Spaces created before Phase D have `takosumi_installation_id = NULL`. A backfill
migration or script should iterate through these spaces and call
`createTakosumiInstallation` for each.

### Dead code cleanup

Done: the unused `space-crud-writes.ts` duplicate was deleted. The live writer
is `space-crud-write.ts` (singular).
