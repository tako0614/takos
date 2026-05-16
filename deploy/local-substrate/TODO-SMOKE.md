# Local-substrate smoke TODO

These remain deferred. Each needs upstream work in the actual product
(instrument the service, build the missing entry point, etc.) — they
can't be smoked from the test bed alone.

## P1 — Workers profile kernel smoke

The `kernel-workers` service in `compose.substrate.yml` is a placeholder
(`echo 'workers profile not yet implemented' && sleep infinity`). The
postgres-profile kernel runs under Deno; a workers-profile kernel would
run under miniflare with D1.

Today's smoke covers the workers code path indirectly: the
takosumi-cloud-worker IS on workerd+D1 (postgres profile or not — it
always runs there), and oauth-e2e / install-preview / passkey / stripe
all hit it. So Cloudflare's worker path *for accounts-service* is
covered.

What's NOT covered is the kernel itself running on workerd. Building
that requires:
1. A kernel entry that exports `default { async fetch(req, env) }` —
   the JSR `@takos/takosumi-kernel` package today exports a Deno server,
   not a worker module.
2. D1 schema applied via `wrangler d1 migrations apply` or `db.exec`
   on first boot (kernel currently does Postgres migrations).
3. Then `scripts/cli-smoke.sh` could be re-run against the workers-
   kernel endpoint.

The cleanest path is upstream: open an issue against
`@takos/takosumi-kernel` to add a worker entry point. Until that lands,
this smoke can only stub.

## P2 — Multi-instance ActivityPub federation

`yurucommu` is the only product in the ecosystem with a working AP
implementation (`src/backend/routes/activitypub/*`). It needs:
- a running database (drizzle migrations applied),
- HTTP signing keys,
- 2 isolated instances on different `*.test` hostnames,
- a smoke that has inst-a Follow inst-b → assert Accept activity.

Booting yurucommu's backend in local-substrate is ~1 day of work
(Postgres schema, migrations, env wiring, ActivityPub keypair gen).
Tracked separately; landing page + `.takosumi/app.yml` are enough for
today's install-link smoke.

When ready:
1. Add `yurucommu-a` + `yurucommu-b` services to compose with separate
   DB schemas.
2. Caddy: `inst-a.takos.test` / `inst-b.takos.test` → respective backend.
3. `scripts/federation-smoke.sh` posts a Follow from a → b, asserts
   the corresponding Accept activity is delivered.

## P3 — wrangler dev --remote

Closer-to-prod test against real Cloudflare bindings (KV / DO / Queues
/ D1). Requires:
- Cloudflare account credentials (CLOUDFLARE_API_TOKEN env)
- `wrangler-staging.toml` separate from production
- Staging-only D1 / KV / DO namespaces

Add as a separate `scripts/wrangler-remote-smoke.sh` that's opt-in (not
in the default smoke run) and reads creds from the user's keychain or
1Password CLI.

Today's miniflare-based cloud worker smoke catches the *code* path; this
would catch the *infrastructure* path (binding semantics that miniflare
emulates imperfectly: Queue ordering, DO single-instance guarantees,
KV eventual consistency).
