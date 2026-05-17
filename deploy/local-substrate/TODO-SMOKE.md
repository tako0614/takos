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
`subjectCanAccessAccount()` (see `account-session.ts`). CI runs the strict smoke directly, so any regression back to the
open behavior is a hard FAIL.

## Full ActivityPub Follow → Accept federation smoke

Today's `scripts/federation-smoke.sh` brings up `yurucommu-a` and `yurucommu-b` on inst-a.takos.test / inst-b.takos.test
and verifies:

- both nodeinfo + webfinger respond
- cross-instance reach through Caddy

What's NOT yet fully smoked: the Follow / Accept exchange. `scripts/federation-follow.sh` now covers the first half:
login on both yurucommu instances, inst-a fetches inst-b's actor, and `POST /api/follow` persists the Follow row as
`pending`. Updated state of play (2026-05-17):

1. **No public signup endpoint exists.** yurucommu is a single-user instance — `POST /api/auth/login` returns the
   pre-existing `owner` actor (or creates a default "tako" owner the first time) gated on a PBKDF2-hashed
   `AUTH_PASSWORD_HASH` env var. `POST /api/auth/accounts` creates sub-accounts but requires an already-signed-in actor.
   So provisioning two distinct subjects on inst-a vs inst-b means each instance gets the same "tako" owner under a
   separate `APP_URL`, which is fine for federation testing (the actors have different `ap_id`s).
2. **`POST /api/auth/login` now has deterministic local-substrate fixtures** in `env/yurucommu-{a,b}.env`, so the smoke
   can create / reuse each instance's default owner actor with one known fixture password.
3. **`POST /api/follow` is the internal create-Follow hook.** The partial smoke uses it to create the Follow row and
   prove inst-a can fetch inst-b's actor through Caddy + Pebble TLS.
4. **Accept delivery is still missing in Deno mode.** The Follow activity delivery depends on the queue/worker path
   (`DELIVERY_QUEUE` in Worker mode), so the smoke cannot yet prove inst-b receives the Follow, emits Accept, and inst-a
   flips the row to accepted.

Best path forward: add a memory-backed delivery worker in `src/backend/server.ts` for Deno local mode, or add a
synchronous HTTP-signature delivery hook guarded by `LOCAL_SUBSTRATE_TEST_BED=1`, then extend `federation-follow.sh` to
poll inst-b's followers collection and inst-a's accepted status.

In the meantime `federation-smoke.sh` verifies wire-level reachability (nodeinfo + webfinger + cross-reach through
Caddy), and `federation-follow.sh` verifies the pre-delivery Follow creation path.

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
