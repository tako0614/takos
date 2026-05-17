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

## Full ActivityPub Follow → Accept federation smoke

Today's `scripts/federation-smoke.sh` brings up `yurucommu-a` and `yurucommu-b` on inst-a.takos.test / inst-b.takos.test
and verifies:

- both nodeinfo + webfinger respond
- cross-instance reach through Caddy

What's NOT yet smoked: the actual Follow / Accept exchange. That needs:

1. A signup endpoint that doesn't require admin password (yurucommu's signup is currently gated).
2. HTTP Signature keypair generation per actor (yurucommu emits this on user create — would just need to call the user
   create API).
3. POST to /actor/<user>/outbox with a Follow activity targeting the remote actor, polled for the corresponding Accept
   on the remote side.

About 1–2 hours of yurucommu API spelunking + signing helpers.

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
