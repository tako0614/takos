# Takoserver fetch tracer (public Provider 4.0.0 integration)

This directory is an opt-in, hermetic integration tracer for validating a Takos
Worker lifecycle against a Takoform Host with the published
`terraform-provider-takoform` v4.0.0 package. It is not the Takos product
runtime, the default OpenTofu deployment surface, or a claim that all Takos
deployments run on Takoserver. It is also not publication/live-release evidence.

The tracer creates exactly five Host Worker resources named by the Provider 4
contract (`takoform_module_worker`, `takoform_worker_bundle`,
`takoform_worker_version`, `takoform_worker_deployment`, and
`takoform_worker_endpoint`), checks exact v1 discovery/readback identities,
probes the returned Worker, then destroys the graph and proves exact absence.
The fixture pins the public registry source to exactly `= 4.0.0` and commits
the package checksum lockfile. Each run uses an isolated project name and an
isolated `TF_DATA_DIR`; only direct registry installation is configured. Local
provider binaries, development overrides, plugin caches, generated state, and
provider source trees are not accepted.

The lockfile's six `zh:` entries are the canonical checksums from the public
release's exact [SHA256SUMS asset](https://github.com/tako0614/terraform-provider-takoform/releases/download/v4.0.0/terraform-provider-takoform_4.0.0_SHA256SUMS),
whose detached signature is the matching [SHA256SUMS.sig asset](https://github.com/tako0614/terraform-provider-takoform/releases/download/v4.0.0/terraform-provider-takoform_4.0.0_SHA256SUMS.sig).
Registry platform metadata must resolve those GitHub assets (not a generic
registry download URL) and the release signing key ID
`34FC18AC897FB709` / fingerprint
`3510E75E05BBCC303B92D77934FC18AC897FB709`.

The portable owner tests are hermetic: they inject captured registry metadata,
`SHA256SUMS`, and detached-signature bytes and never contact the Registry or
GitHub. A real tracer invocation performs the bounded network fetch and
cryptographic verification immediately before `tofu init`; release/evidence
cadence must therefore run the owner entrypoint online and retain the emitted
source URLs and asset digests alongside the report. A hermetic test run alone
is not live provenance evidence.

The real Registry/GitHub init proof is kept out of the portable gate. Run it
explicitly on an online owner cadence with:

```bash
bun run test:takoserver-fetch-tracer:online
```

That test is expected to fail when outbound access is disabled; its result is
online evidence, not a portable `bun run check` pass.

Invoke the owner entrypoint with both credentials supplied by environment
variables (the values are never accepted in argv):

```bash
TAKOFORM_TOKEN='mutation-token' \
TAKOFORM_EVIDENCE_TOKEN='readback-token' \
bun scripts/takoserver-fetch-tracer.ts --run \
  --host https://host.example \
  --organization-id TAKOSERVER_ORGANIZATION_ID --space SPACE_ID \
  --endpoint-origin-template 'https://{project}.workers.example/'
```

`TAKOFORM_TOKEN` is copied only into the OpenTofu child environment for
mutation. `TAKOFORM_EVIDENCE_TOKEN` is used only for direct Host discovery,
resource readback, post-destroy absence GETs, and the organization-scoped
native residual reads. The organization ID is a non-secret Takoserver
authority coordinate, not a substitute for the evidence credential. The
environment variable names may be changed with `--token-env` and
`--evidence-token-env`, but both values remain operator-private environment
inputs and must be distinct. Never put either value in a command line,
fixture, report, or repository file.

`--endpoint-origin-template` declares the exact project-derived endpoint
origin. It must be an HTTPS origin-root template containing one `{project}`
placeholder; the runner materializes it with a fresh 32-byte cryptographic
nonce-derived project name and rejects IP, loopback, private, or local targets.
An `.invalid` endpoint is accepted only when `--host` is an explicit loopback
HTTP diagnostic origin.

The entrypoint runs `tofu init -backend=false -lockfile=readonly`, validates
the exact public lockfile, records the executable/provider digests, and parses
`tofu show -json` to prove exactly five create actions before executing
`validate -> plan -> apply -> output / readback -> Worker probe -> destroy ->
state/Host-absence/endpoint-absence/native-absence proof`. The root Worker
response must echo the fresh nonce and project UID. The tracer also performs
anonymous `GET /health` and `GET /.well-known/takos` checks. Discovery is
deliberately scoped to this artifact: it declares only neutral JavaScript
`fetch`, says `fullRuntime: false`, and must not be read as evidence for Takos
Durable Objects, Vectorize, agent containers, or Cloudflare-native topology.
If Apply fails,
cleanup and exact absence are still attempted; a cleanup failure is reported
separately without replacing the original phase failure, and failed absence
readback preserves the recovery workdir for the operator.

Host resource absence and assigned endpoint absence are separate ledger entries.
For a live HTTPS Host, success additionally requires Takoserver's closed,
organization-scoped native-residual readback to attest exact absence for all
five pre-destroy Host UIDs. The response must be non-cacheable, identify its
intrinsic/provider source, and carry bounded effect/deployment ledger counts.
`status: "absent"`, not zero historical counts, is the native-absence
authority. This integration-only evidence may record zero native residual for
those five resources, but it never claims GA readiness or coverage of the full
Takos runtime.

The fixture keeps the separate control-profile output contract narrow:
`resource_identities`, `endpoint_url`, `endpoint_hostname`, `config_value`,
`project_nonce`, and `project_uid`. The five UIDs are derived from the exact
identity output rather than duplicated in a second output. The control
wrapper's explicit `--product takos --profile takoserver` lane consumes this
shape, while its default Takos lane remains `deploy/opentofu/cloudflare`. The
control profile currently binds its external public-URL evidence to the exact
root correlation response; this owner entrypoint additionally requires the
anonymous health and scoped discovery routes. This repository does not weaken
or replace the default Takos install to bridge that evidence-scope difference.

For an explicit HTTP loopback Host, the local Worker module is exercised only
as a diagnostic. Its synthetic `.invalid` endpoint has no host-runtime route,
so endpoint absence is recorded as `not-applicable`, lifecycle absence is not
marked passed, and `hostRuntimeEligible`, `e2eEligible`, and `gaEligible` are
all false.

An endpoint on a `.invalid` hostname is a loopback-only diagnostic path and is
never treated as public Worker evidence. A live run must return an assigned
public endpoint and a fresh credential pair from the Takoserver operator.
