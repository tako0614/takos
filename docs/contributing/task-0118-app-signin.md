# TASK-0118: app-scoped Accounts sign-in

Status: additive compatibility change; no deployment or live sign-in.

This task spans Takos, takos-git, takos-storage, takos-office and
takos-computer. Each repository has its own branch, PR and CI. The shared
TASK-0118 ownership contract is the integration authority. Before editing,
compare open PRs, recent TASK-0117 branches and active uncommitted files.
Office runtime integration is handed to its existing writer as exact proposed
hunks when files overlap.

## Takos authority

The install context supplies `app_capsule_id`, projected as `APP_CAPSULE_ID`.
When configured, app evidence must match that exact id. A foreign id,
malformed role, inconsistent workspace binding or malformed claims envelope
fails closed, even with legacy workspace claims. When not configured, Capsule
claims are ignored and the existing legacy validation applies.

Current Accounts emits `capsule_id`, `workspace_id`, legacy `role` and a
singleton `workspace_memberships`; `app_role` is added by unmerged Takosumi
#657. Exact Capsule matches therefore retain the verified external Workspace.
Legacy owner/admin/member/viewer roles preserve membership (owner stays owner;
the others are app members; a legacy membership without role stays a member)
without granting local Takos admin powers. Modern `app_role` owner/member claims
remain supported. A Capsule-only ordinary account
can sign in with no Workspace authority. Takos has no `APP_WORKSPACE_ID`
setting: the pre-existing strict singleton claim validation remains its binding.

The validated Workspace is persisted with the user's encrypted OAuth grant
and forwarded by the Bearer pipeline, so existing Interface launcher, MCP and
AI Gateway discovery continue to work for current Accounts members. Ordinary
accounts cannot select another stored grant or use operator gateway credentials.
They also cannot receive `OPENAI_API_KEY`, including in development or with the
self-host key opt-in: configured-app key handout revalidates the triggering
user's delegated UserInfo and current app membership before returning a key.
Claim-absent legacy clients retain the original verified singleton Workspace
membership gate for this opt-in.
Unconfigured legacy self-host shared-key opt-in behavior remains unchanged.
UserInfo credential requests do not follow redirects.

Workspace-bound delegation keeps the existing Workspace control routes,
including the primary Capsule list route. Genuinely workspace-less delegation
uses `GET /api/v1/apps` and `POST /api/v1/install-plans` with `mode: "attempt"`.
The apps and raw account-session APIs depend on unmerged Takosumi #663 and are
not available on current main. Missing or denied upstream routes remain explicit
errors; they never become empty success lists or widen into an operator/local
Workspace fallback. Exact plan id, Capsule id, source reference and Run id
checks remain in place before review, approval, apply and destroy operations.

The new apps response is value-free and contains no authorized Interface
documents. Workspace-less summaries do not invent service URLs, Interface
bindings or credentials. Launcher, MCP and AI Gateway remain Workspace-bound
until their workspace-less protocol is specified; they fail closed without
that selector. This is a remaining integration boundary.

## Forward D1 migration: retire delegated_workspace_id in Phase 9

`auth_identities.delegated_workspace_id` stays present and readable throughout
the compatibility period. A null value now means delegation uses per-account
app APIs; it does not mean an invalid or missing OAuth grant. Existing scope,
expiry, encrypted-token and refresh-lease checks still apply.

The Phase 9 forward migration must be allocated after the latest merged
control-schema migration. Before applying it:

1. Verify Accounts and every installed client emit/consume app claims and no
   active legacy delegation needs a workspace selector. Snapshot the database
   and count remaining non-null selectors without collecting token values.
2. Deploy a reader/writer that no longer selects or updates this column. Retain
   encrypted tokens, scopes, expiry and refresh leases. Users needing an old
   grant must reauthorize; never derive a broader grant from a local workspace.
3. Apply a new forward migration dropping the column and update the Drizzle
   schema and generated runtime migration set together. Do not edit historical
   migrations or add this drop to the present change.
4. Verify cached, concurrent-refresh and failed-refresh delegation on the new
   schema. Reversal after the schema drop is a forward repair that re-adds the
   nullable column; restoring its old authorization semantics requires the
   snapshot and compatible code.

## Validation

Run focused OIDC/browser-Bearer, delegation refresh, app lifecycle, control-path
and install-manifest tests. Run source formatting, lint, Worker/web type checks,
OpenTofu formatting, architecture and relevant docs checks. CI runs the full
portable gate; do not run the local full gate on the shared low-space SSD.

Independent review regression evidence (2026-10-29): six claim/Bearer tests
failed before the fix (discarded Workspace, missing legacy role and unconfigured
Capsule lockout). The ordinary-account funding regression separately failed
because development mode returned the operator key. After the fixes, 99 focused
tests across 11 files passed, including current claims, empty ordinary-account
memberships, Interface/MCP/Gateway discovery, primary Workspace app listing and
explicit upstream 404/403 responses. Worker/web type checks, lint, source and
OpenTofu formatting, architecture/current/API docs, migration-set, queue,
runtime-secret, migration-safety and release-reference checks passed. The
UserInfo fetch seam no longer requires Bun's unrelated `fetch.preconnect`
property, retiring seven declared test type diagnostics. The full portable gate
is delegated to PR CI; no local full suite, deploy or live sign-in was run.
