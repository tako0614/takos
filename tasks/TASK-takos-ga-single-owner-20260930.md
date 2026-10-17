# Takos GA: one owner per self-deployed instance

Date: 2026-09-30 UTC
Status: source_reviewed / deployment and integration pending
Owner: Takos dedicated session
Required for: security, identity, authorization, production_or_release
Grants upstream permissions or production mutation authority: false
Repository mutation scope: takos only
Source base: 3b79815f96b986eea138534f337c9580f49ab2d2

## Authoritative product premise

User clarified that Takos is personal software each person deploys for themselves.
A deployed instance has one owning user. It is not a shared SaaS enrolling multiple
owners. External communication counterparts, shared-link recipients and app/MCP
participants are not owners; preserve their independent features and access rules.

Already coherent: one Principal owns multiple private Workspaces; active owner and
owner-witness checks prevent a different Principal from reading/writing them.
There are no Workspace invite/role controls. Thread share links are separately
owner-authorized public/password publication and must not be removed.

Contradiction: callback and Accounts bearer auto-provision any new issuer/subject
as another local user. An existing regression explicitly expects two users with
the same verified email. Cookie resolution admits any cached active user. /setup
is a per-profile completion flag, not an enrollment or owner selection procedure;
bootstrap docs incorrectly described it as username registration.

## Product-owned correction

operator pins OIDC_OWNER_SUBJECT before exposing login. The existing configured
OIDC_ISSUER_URL plus exact subject identifies the sole instance owner. Missing or
invalid pin refuses admission. Neither the first visitor, email match, verified
email nor parent Workspace membership chooses the owner. Credentials, issuer,
client grants and upstream account lifecycle remain external Accounts authority.

Enforce the same boundary before callback account/identity provisioning,
Accounts delegation storage, session creation, bearer auto-provision and old cookie
admission. Queued/active Run execution and pending MCP OAuth callbacks require
the same current owner. Resolve the owner's app-local Principal from its matching authIdentity.
Fresh admission must commit identity+profile atomically; simultaneous requests for
the same owner re-read the one winner without orphan owner-2 profiles.
Delayed app-owner device push delivery also checks the current owner. A former
owner delivery settles its durable outbox without deleting notification/device
records; missing owner configuration retains pending delivery and retries. This
does not restrict public shares or external communication recipients.
Historical other profiles/participants/Workspaces are retained; no delete, merge,
auto-link, grant or silent ownership transfer occurs. A changed operator pin is
an authority change, not permission to hand another identity existing private data.

The normal Cloudflare module already accepts non-secret app config in var.env and
passes it to Worker text bindings. Use env={OIDC_OWNER_SUBJECT="<exact-owner-sub>"};
Node configuration carries the same field with no permissive development fallback.
identity.oidc's four issuer/client/redirect values are unchanged and do not imply
an instance owner. Accounts must document any pairwise browser/mobile subject
relationship; do not auto-alias a second subject or treat a common Workspace claim
as identity proof. This is an integration proposal, not a shared contract edit.

## GA acceptance and verification

- Exact configured owner can complete OIDC login and /setup, use its bearer, create
  multiple private Workspaces and run tools/checkpoint recovery.
- A second signed subject, including one with the same verified email and matching
  upstream Workspace, is denied before account/identity/delegation/session writes.
- An admin-scoped Accounts PAT from another subject cannot provision or bypass
  instance ownership. Existing second-user cookie or other credential paths cannot
  reuse cached users to bypass the pin.
- Concurrent owner bootstrap produces one Principal and one identity. No public
  first-login race claims the installation; missing pin fails closed.
- External sharing/communication remains governed by its existing recipient and
  capability rules. Such recipients are not enrolled as instance owners.
- Published/deployed artifact identity and a real self-owner installation with
  browser/bearer/Run/recovery/monitor readback remain unproven until executed.

Focused regression, old-source red, independent review and complete owner gate
are being executed. Exact commit/CI will be recorded after verification.
No production deploy, new client grants, secrets, billing, existing-resource cleanup
or other worktree changes are authorized/performed by this task.

## Source review and local evidence

Independent Sol review traced callback, Accounts bearer/PAT, cached cookies, Git
Basic, MCP OAuth, trusted WebSocket header admission, queued/container Run control,
maintenance and device push. It identified background Run and pending MCP bypasses,
raw issuer normalization asymmetry, and former-owner device delivery; these are
fixed in the owning Takos paths. Maintenance/index processing of retained data is
kept. No remaining source-gate P1/P2 was identified after those fixes.

Real libsql tests cover owner/other-subject/profile and cached-cookie suspension.
Another real-DB test gives a legacy second Principal its own Workspace with an
active owner witness: queue/bootstrap still deny it, while the pinned owner runs.
Push queue tests prove no gateway request for the former owner, retained rows,
settled outbox, and pending retry when the pin is absent. Node keeps the raw subject
so padded config does not silently select another subject.

OpenTofu's full local tests and both saved runtime-secret plans pass. Each plan
projects exactly one plain_text OIDC_OWNER_SUBJECT with its exact synthetic value;
secret-value/grant closure remains unchanged. Compose forwards the same operator
config, and its example leaves the subject empty until deliberately configured.

Complete repository gate, docs build and exact committed CI are recorded in the
dedicated integration result after execution. Live Accounts/browser/mobile
subject correspondence and deployed provider atomicity remain unverified.

Old-source witness: tmp/ga-notifier-state-guard/owner-red/regression.log records
34 passes and eight expected failures against 3b79815. The copied tests/helper
hashes and exact production base are in owner-red/manifest.json. A successful
current helper test alone is not used as old-production admission proof.

Local complete-gate attempt reached static/type, 1,409 portable tests, 20 OpenTofu
tests and all Rust compile/Clippy/default+mock-feature phases. Mandatory debug
Worker recovery then exceeded its unchanged 150-second full-SQLite migration
deadline. The proof process was supervised and the failed context/log retained.
The separate owner-fenced OCI recovery on the same source completed successfully.
Do not report the local composite gate as green; exact committed CI readback is
recorded separately in PR126 and the dedicated integration result.
