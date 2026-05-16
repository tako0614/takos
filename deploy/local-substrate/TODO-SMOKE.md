# Local-substrate smoke TODO

These are deferred test-bed additions that each need a non-trivial design
call before implementation. Listed in rough order of "what would catch the
most regressions if implemented next."

## P1 — Workers profile kernel smoke

The `kernel-workers` service in `compose.substrate.yml` is a placeholder
(`echo 'workers profile not yet implemented' && sleep infinity`). The
postgres-profile kernel runs under Deno; the workers-profile kernel would
run under miniflare with D1. Without it, smoke only covers the Deno+Postgres
code path; the Cloudflare-deployed kernel could diverge silently.

Blockers:
- Need a kernel entry that exports a workerd-compatible Worker module.
- D1 schema must be applied via the existing `wrangler d1 migrations apply`
  or by inline `db.exec` on first boot.
- Tests would otherwise mirror cli-smoke.sh against `kernel-workers`.

## P2 — OpenTelemetry / distributed trace

No service currently emits OTel. Adding `otel-collector` (+ Jaeger or Tempo)
to compose lets us add a smoke that asserts traces actually arrive when
the substrate services start exporting. Right now there's nothing to trace.

Steps when ready:
1. Add `@opentelemetry/api` + autoinstrumentation to:
   - accounts-service (cloud worker)
   - takosumi kernel
   - takos-app / takos-git
2. Stand up `otel/opentelemetry-collector-contrib` with OTLP/gRPC ingest.
3. Add `jaegertracing/all-in-one` with UI at `jaeger.takos.test`.
4. Smoke: trigger a request through the stack, GET Jaeger's `/api/traces`
   and assert spans for each hop are present.

## P3 — Multi-instance federation (ActivityPub)

`inst-a.takos.test` + `inst-b.takos.test` with separate Postgres schemas
and independent takos-app instances, then smoke `inst-a follows inst-b
user → inst-b receives Follow activity → inst-a sees Accept`.

Blockers:
- Need to confirm takos-app's federation code path is at the layer we
  want to test (vs ActivityPub library defaults).
- Each instance needs its own substrate-postgres schema namespace.

## P4 — Migration rollback drill

Accounts-service uses `CREATE TABLE IF NOT EXISTS` so there's no actual
migration framework (no up/down pairs). A rollback drill requires building
the migration plumbing first. Tracked under per-product `AGENTS.md`.

## P5 — k6 load baseline

Define target RPS / p95 latency for each critical endpoint:
- POST /v1/installations
- POST /v1/auth/upstream/callback
- POST /v1/auth/passkeys/authenticate/complete
- POST /v1/billing/stripe/webhook

Pick a baseline (e.g. 50 RPS sustained @ p95 < 200ms locally) and add
`scripts/k6-baseline.js`. Run on-demand; not part of smoke (too slow).

## P6 — `wrangler dev --remote`

Closer-to-prod test that exercises real Cloudflare bindings (KV / DO /
Queues / D1) against staging CF infrastructure. Requires:
- Cloudflare account credentials
- Separate `wrangler-staging.toml`
- CI secrets for `CLOUDFLARE_API_TOKEN`

Add as a separate `scripts/wrangler-remote-smoke.sh` that's opt-in (not
in the default smoke run).
