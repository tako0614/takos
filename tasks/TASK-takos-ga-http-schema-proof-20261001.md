# TASK: Takos production HTTP schema admission native proof

## Scope and ownership

Takos-only source worktree `/root/hdd/takos-dev/worktrees/takos-ga-20260930-1737`, branch
`dev/takos-ga-20260930-1737`; starting commit
`dd309e6c95bf0e30fd0288059b11e14666225029` / tree
`1c7409218a32f5317122f9cfe9bdd39928d14ed1`.
The parent owns integration, docs, this ledger and verification; the delegated worker owns only
new `scripts/prove-http-schema-native.ts` and `scripts/prove-http-schema-native.test.ts`.
Other source worktrees and the engine candidate are read-only. Main retains common contracts
and final integration. No cross-repository edit, external communication, production deploy,
image publication, merge, billing, credential grant or existing-data deletion is authorized.

Takos is a personal single-owner self-hosted instance. Multiple private Workspaces and external
communication participants remain valid. This fixture grants no identity or execution authority;
placeholder startup strings are test-only and do not exercise external OIDC.

## Concrete gap

The required native terminal-usage regression calls production `ensureSchemaReady` through
its custom fixture endpoint. It proves native D1 convergence and terminal usage recovery,
but does not prove the real public/default Worker fetch returns its production 503 response.
Inventory: `tmp/ga-native-ci-20261001/http-schema-admission-inventory.md`.
Canonical entrypoint is `src/worker/cloudflare-entrypoint.ts`; fetch delegates through
`createTakosWorker` and `createWebWorker` to `guardRequestSchema` before Hono dispatch.

## Acceptance

- Bundle that exact canonical entrypoint using the existing build helper; load its unchanged
  production graph in separate Node 26.1 / installed Miniflare and actual native workerd.
- Read the deployment Wrangler compatibility date/flags, record config and bundle hashes,
  actual runtime executable/version and all bundle inputs before/after execution.
- Use fresh isolated native D1/KV/DO/queue bindings. Seed only a fixture-owned applying migration
  lock. Ordinary `GET https://admin.example.test/.well-known/takos` must return actual HTTP 503,
  `SCHEMA_MIGRATION_PENDING`, applying state and `Retry-After: 5`. The lock remains held and
  migration ledger stays empty before the domain route can answer.
- Release only that fixture claim through the native host D1. At most two ordinary post-release
  requests must reach discovery HTTP 200 and all embedded migration names/checksums in ledger
  order. Pending must strictly advance a matching prefix, preserve previous applied_at values,
  release its claim and wait the actual retry hint before continuation. A second pending or
  failed/applying/no-progress result stays red. Only ready permits a cached no-op fetch.
- Do not replace the production fetch with a custom gate route, directly call ensureSchemaReady,
  invoke internal migrate/retryFailed, broaden timeouts, alter the default20s budget, or substitute
  mocked/SQLite bindings for native D1. Canonical entrypoint loading is currently unverified.
- Strict JSON report/result-file equality, bounded chunked CI evidence, owned process-group
  supervision and fixed70s inner/75s outer bound. Remove only fresh success fixtures; preserve
  fresh failure diagnostics. No unrelated or existing data is removed.
- Independent implementation/result review, meaningful focused proof, required full
  `bun run check`, exact committed/pushed snapshot and PR/CI raw evidence before qualification.
  Heavy checks require resource preflight and use HDD/nice10/ionice2:7/Cargo jobs2.

## Current evidence

2026-10-01: the canonical Worker bundle loaded in native Miniflare. Initial focused attempt
failed in4.789s before HTTP: multiline native D1 `exec` rejected fixture DDL. Its full15-file
fixture is retained and hashes recorded in `first-failure-preserved.json`.
The lock DDL now uses production-style `prepare(...).run()`.
Focused v2 failed in4.613s before Worker HTTP: Node-global Request was not the installed undici
Request class. Its full15-file fixture is retained in `second-failure-preserved.json`.
The controller now passes Miniflare's URL plus init directly; no request/response route is mocked.

Focused v3 passed at21:10:02UTC in50.811s:1test/377assertions. Actual production HTTP phases:
held lock503/applying/ledger0; ordinary post-release request503/pending/ledger74; real5015.481ms
Retry-After wait; second ordinary request200/106; steady ready request200/106 with unchanged
ledger/lock. Whole source snapshot stayed unchanged and the owned process group vanished.
Complete71-chunk report digest42316baf588092edb186602ecf8e2fa37d4ed7b16df0826b164c6f566c9e5349;
116 selected source/config hashes and719 full-entrypoint bundle inputs unchanged. Actual owned
workerd2026-07-21 hash0e023aad659229a7aee8ae586775883070c5aa22015c1faf99f6cb505f7a63de.
Production Wrangler date2026-04-01 and three flags match. Success fixture removed; both historical
failed fixtures remain byte-identical. Result and parent readback are under
`tmp/ga-native-http-schema-20261001/`.

After that run, the ledger query was strengthened from `ORDER BY name` to `ORDER BY rowid`
to observe insertion order instead of normalizing it. The previous focused success is a separate
snapshot; the required full gate must validate the current rowid query. No budget, timeout,
production migration or authority change was made. Full gate passed as detailed below; current-source CI remains pending.
Independent source/result review returned GO for the rowid source; the older focused report is
qualified separately. The first full gate stopped after13.583s at two new TypeScript diagnostics,
before tests or builds: the installed undici Response type differs from DOM Response, and the
last post-release ledger was typed as possibly undefined. The parser now accepts only its used
status/text response surface and the wrapper explicitly rejects a missing last admission.
No debt ledger, test assertion, quarantine or production behavior was relaxed. Source snapshots
were unchanged and the failed gate's group was absent. A fresh full-v2 gate passed as detailed below.
New2scripts, local guide and this ledger are ready for the source checkpoint; exact-head CI is pending.

## Required full-v2 gate

2026-10-01 21:17:37→21:23:22UTC,344.740s,exit0.1649tests/256files/12336assertions/165.01s.
All formatting/migration/queue/secret/safety checks, lint/types, OpenTofu, architecture, Rust
format/check/Clippy/default/mock/build, mandatory Worker/full-migration SQLite/compiled Rust
process restart and lost-ACK recovery, native notifier and Web/Worker dry-run builds passed.
Types98/lint111 declared debt unchanged; undeclared0.1575frozenfiles before/after equal; owned
process group absent. Local debug binary SHA
c5a78847a305fc9364d6249ec828f60184988b3b5c697f40d969f7a4a70a6f70 is local proof artifact only.

Current HTTP testcase passed32.100s/controller31.863s. Its actual rowid ledger path was
503/applying/0 → ordinary200/106 → steady200/106; no continuation was needed in this run.
68chunks/275811bytes reassemble with digest
35a40098eac5664d9e1e94d10d395a86e9eb37e74ceeaa0861d9e9250a6831e1.
116sources/719inputs were unchanged; held lock remained identical and success fixture disappeared.
The older focused v3 pending74→5.015s→ready106 result remains separately qualified.
Current source hashes:controller770a2545050f659aa3e6b00972e4b89397768445750b88f8658f06a4dcf1f9bf;
wrapperb2c550b92d01c3bf5ba51849907ed2e7aaaee266851d8ba44d9626cf3d363020.
Full log SHA9a6f1f4634c80df808a6dd3374027ea8f07821bbffe0e6ce0733dccc3a2b77d8.
Evidence: `tmp/ga-native-http-schema-20261001/full-v2.json/.log`, `native-full-v2-result.json`,
`parent-native-full-v2-qualified.json` and independent reviews. This ledger result text alone
was updated after the gate; runtime/test/guide bytes match the frozen gate inputs.

## Qualification limits and remaining dependencies

This proof targets local native HTTP admission over a fresh D1. It cannot establish hosted endpoint
readiness, populated migration, arbitrary-host convergence, multi-isolate contention, registered
browser/mobile owner journeys, external backend lifecycle, native compiled-process/Container
composition, release response provenance or consistent whole-instance backup/restore.
Shared Form/Interface/Binding and external edge.sql0110/readiness changes remain main-owned.
