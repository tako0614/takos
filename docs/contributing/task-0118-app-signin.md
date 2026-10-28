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
Accounts UserInfo must match that configured id when it supplies app evidence.
`app_role` is either `owner`, `member`, or absent. A foreign id, malformed role
or malformed claims envelope fails closed, including when legacy workspace
claims are also present. An absent role permits sign-in and follows Takos's
existing local account and resource access rules; it confers no local admin
privileges. Claim-absent clients retain legacy UserInfo workspace validation.

App-scoped OAuth delegation has no workspace selector. It uses
`GET /api/v1/apps` and `POST /api/v1/install-plans` with `mode: "attempt"`.
Legacy delegation retains its external workspace selector and compatibility
routes. Neither path substitutes a local Takos workspace id or operator token.
Accounts checks the caller's live app access on each forwarded control request.
Exact plan id, capsule id, source reference and run id checks remain in place
before review, approval, apply and destroy operations. Access denials do not
retry through a different authority or compatibility route.

The new apps response is value-free. It does not contain authorized Interface
documents. Workspace-less app summaries therefore do not invent service URLs,
Interface bindings or runtime credentials. The existing Interface launcher,
MCP and AI-gateway discovery remain workspace-bound compatibility consumers
until their workspace-less protocol is specified; they fail closed without
that selector. This is a remaining integration boundary, not evidence that
workspace-less runtime Interfaces are implemented.

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
