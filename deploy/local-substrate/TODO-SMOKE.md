# Local-substrate smoke TODO

Remaining items after the false-confidence cleanup pass. Each needs either upstream product work or a coordination call
(out of scope of the test bed itself).

## Workers-profile kernel — LANDED (local Miniflare smoke as of 2026-05-17)

`takosumi/deploy/cloudflare/` is the Worker-first kernel scaffold. It bundles `deploy/cloudflare/src/worker.ts`, runs
the kernel in-process through `createPaaSApp`, persists kernel snapshots / public deploy records in D1, and stores
artifacts in R2. It has no Cloudflare Container binding.

The local-substrate now runs that same bundle under Miniflare:

1. `takosumi-kernel-worker-build` bundles `takosumi/deploy/cloudflare/src/worker.ts`.
2. `takosumi-kernel-worker` serves it at `kernel-worker.takos.test` during the default postgres-profile smoke so the
   normal Takos product stack can keep using the Deno+Postgres kernel at `kernel.takos.test`.
3. `kernel-workers` is the replacement workers-profile service, aliasing itself as `kernel` when `--profile workers` is
   selected.
4. `scripts/workers-cli-smoke.sh` now verifies both workerd code paths: the Accounts Worker on D1/R2 and the Takosumi
   kernel Worker on D1/R2/Queue/DO (`/healthz`, `/__takosumi/exports/*` signature rejection, `/storage/healthz`,
   `/coordination/healthz`, `/queue/test`, and `/health`). It uses `kernel-worker.takos.test` for the postgres-profile
   mirror and `kernel.takos.test` for the workers profile.

## Tenant isolation — LANDED (smoke strict as of 2026-05-17)

`scripts/tenant-isolation.sh` runs in strict mode (subject B's cross-read of subject A's installation must be non-200).
The upstream fix lives in `takosumi-cloud/packages/accounts-service/src/installation-routes.ts` —
`handleGetAppInstallation` + `handleListAppInstallations` now go through `requireAccountSession()` +
`subjectCanAccessAccount()` (see `account-session.ts`). CI runs the strict smoke directly, so any regression back to the
open behavior is a hard FAIL.

## Full ActivityPub Follow → Accept federation smoke — LANDED (strict as of 2026-05-17)

`scripts/federation-smoke.sh` brings up `yurucommu-a` and `yurucommu-b` on inst-a.takos.test / inst-b.takos.test and
verifies:

- both nodeinfo + webfinger respond
- cross-instance reach through Caddy

`scripts/federation-follow.sh` now covers the full happy path:

1. **No public signup endpoint exists.** yurucommu is a single-user instance, so `POST /api/auth/login` returns the
   pre-existing `owner` actor (or creates a default "tako" owner the first time) gated on a PBKDF2-hashed
   `AUTH_PASSWORD_HASH` env var. `POST /api/auth/accounts` creates sub-accounts but requires an already-signed-in actor.
   So provisioning two distinct subjects on inst-a vs inst-b means each instance gets the same "tako" owner under a
   separate `APP_URL`, which is fine for federation testing (the actors have different `ap_id`s).
2. **`POST /api/auth/login` now has deterministic local-substrate fixtures** in `env/yurucommu-{a,b}.env`, so the smoke
   can create / reuse each instance's default owner actor with one known fixture password.
3. **`POST /api/follow` is the internal create-Follow hook.** The strict smoke reaches it with a valid session and body,
   and yurucommu's local-substrate-only guard allows HTTPS `*.takos.test` actor fetches only when
   `YURUCOMMU_ENABLE_LOCAL_SUBSTRATE_REMOTE_FETCHES=true` and local DNS resolves to `127.0.0.1` or Docker bridge
   `172.16.0.0/12`.
4. **Deno mode now has local delivery queue bindings.** `YURUCOMMU_ENABLE_DENO_DELIVERY_QUEUE=true` attaches an
   in-memory Queue-compatible drain in `src/backend/server.ts`, so the existing Worker queue path runs locally without
   adding remote POSTs to request handlers.
5. **The strict assertion polls accepted relations.** The script fails unless inst-b's followers collection contains
   inst-a and inst-a's following collection contains inst-b, proving Follow delivery, Accept emission, and
   accepted-state finalization.

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
