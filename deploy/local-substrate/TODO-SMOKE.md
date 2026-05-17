# Local-substrate smoke TODO

Remaining items after the false-confidence cleanup pass. Each needs either upstream product work or a coordination call
(out of scope of the test bed itself).

## Workers-profile kernel — needs upstream lazy-init + D1 adapter

`takosumi/packages/kernel/src/index.ts` _does_ `export default app` (a Hono app), so structurally it's
worker-compatible. But the same file runs Postgres-tied boot code at module load (`npm:pg`, SQL migration runner, audit
replication chain verification), all of which fail when hosted on workerd.

To make the workers profile actually run the kernel itself on workerd:

1. Move every effectful boot step in kernel/src/index.ts into a `bootstrap()` helper that's invoked lazily from the Hono
   fetch handler the first time a request lands (memoized).
2. Add a D1 adapter alongside the SqlClient pg pool path so kernel stores can land on either.
3. Replace `kernel-workers` placeholder with a miniflare runner mirroring wrappers/takosumi-cloud-worker-runner.mjs.

For now the cloud worker (`takosumi-cloud-worker`) IS the workerd code path that smoke exercises — see
scripts/workers-cli-smoke.sh + the ~17 cloud.* / oauth.* / install.preview.* / passkey.* / stripe.* smoke checks.
Kernel-on-workerd is upstream work tracked in @takos/takosumi-kernel.

## Tenant isolation — LANDED (smoke strict as of 2026-05-17)

`scripts/tenant-isolation.sh` runs in strict mode (subject B's cross-read of subject A's installation must be non-200).
The upstream fix lives in `takosumi-cloud/packages/accounts-service/src/installation-routes.ts` —
`handleGetAppInstallation` + `handleListAppInstallations` now go through `requireAccountSession()` +
`subjectCanAccessAccount()` (see `account-session.ts`). CI runs with `TENANT_ISOLATION_STRICT=1` so any regression back
to the open behavior is a hard FAIL.

## Full ActivityPub Follow → Accept federation smoke

Today's `scripts/federation-smoke.sh` brings up `yurucommu-a` and `yurucommu-b` on inst-a.takos.test / inst-b.takos.test
and verifies:

- both nodeinfo + webfinger respond
- cross-instance reach through Caddy

What's NOT yet smoked: the actual Follow / Accept exchange. Round 2 attempted to add this and learned the surface is
bigger than the 1–2 hour estimate. Updated state of play (2026-05-17):

1. **No public signup endpoint exists.** yurucommu is a single-user instance — `POST /api/auth/login` returns the
   pre-existing `owner` actor (or creates a default "tako" owner the first time) gated on a PBKDF2-hashed
   `AUTH_PASSWORD_HASH` env var. `POST /api/auth/accounts` creates sub-accounts but requires an already-signed-in actor.
   So provisioning two distinct subjects on inst-a vs inst-b means each instance gets the same "tako" owner under a
   separate `APP_URL`, which is fine for federation testing (the actors have different `ap_id`s).
2. **`POST /api/auth/login` needs `AUTH_PASSWORD_HASH` in the yurucommu-a/b env.** Generating the PBKDF2 hash is a
   one-time setup task; the helper is in `yurucommu/src/backend/utils/password.ts`.
3. **No public POST outbox endpoint.** The federation activity is emitted by yurucommu's own room/posting code; the
   `ap.get("/ap/users/:username/outbox")` route is read-only. A real Follow activity would need to go through whatever
   internal API creates Follow records (TBD — possibly the rooms/communities API, possibly the federation worker).
4. **HTTP Signature on outbound POSTs** is then handled by yurucommu's federation queue; the test would just need to
   poll inst-b's followers collection for inst-a's actor.

Best path forward: write the smoke against the internal "create Follow" API once that API surface is identified, OR add
a minimal `POST /api/test/follow` endpoint guarded by a `LOCAL_SUBSTRATE_TEST_BED=1` env to give the smoke a direct
hook. Either way the work is bigger than originally scoped — track separately.

In the meantime `federation-smoke.sh` continues to verify the wire-level reachability (nodeinfo + webfinger + cross-
reach through Caddy) which catches the most common regression class (one yurucommu instance can't see the other at all).

## brand-tokens JSR package (D13)

Today `takos/website/src/styles/{tokens,global}.css` is a 691-line fork of `takosumi/website/src/styles/global.css`.
They will drift. The right fix is a small JSR package `@takos/brand-tokens` shipping:

- `tokens.css` — colors / typography / spacing / radii
- `components/{GeometricMark,InkdropMark,Wordmark}.tsx` — framework- agnostic mark + wordmark components

Then both takos/website and takosumi/website import from JSR. Out of scope of the test bed (publishing a new JSR scope +
coordination with takosumi/website + landing PRs across multiple repos).

## smoke.d/ full split (D17 — partial)

scripts/smoke.sh has a `run_script <label> <cmd>` helper that captures stdout+stderr to `$SMOKE_LOG_DIR/<label>.log` on
failure. CI uploads that dir as an artifact. Today the helper is plumbed into a few key checks (oauth, passkey, stripe,
federation, kernel-deploy). The full refactor to per-script files under `scripts/smoke.d/*.sh` with auto- discovery is
mechanical but bigger; not strictly necessary now that log capture works.

## wrangler dev --remote

Closer-to-prod test against real Cloudflare bindings (KV / DO / Queues / D1). Requires:

- Cloudflare account credentials (CLOUDFLARE_API_TOKEN env)
- `wrangler-staging.toml` separate from production
- Staging-only D1 / KV / DO namespaces

Add as a separate `scripts/wrangler-remote-smoke.sh` that's opt-in (not in the default smoke run) and reads creds from
the user's keychain or 1Password CLI.

Today's miniflare-based cloud worker smoke catches the _code_ path; this would catch the _infrastructure_ path (binding
semantics that miniflare emulates imperfectly: Queue ordering, DO single-instance guarantees, KV eventual consistency).
