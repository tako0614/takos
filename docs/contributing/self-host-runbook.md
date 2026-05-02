# Self-host Distribution Runbook

This runbook covers the current self-host proof path for the current PaaS
surface. Run local validation from `takos/paas`. Treat live self-host execution
as operator-owned evidence: the OSS PaaS repo contains public distribution
templates and smoke tooling, while concrete deploy files, secrets, hostnames,
and provider credentials belong outside this repo.

## 1. Validate the public template

The self-host template is `deploy/distributions/selfhosted.json`. It declares
the `@takosumi/plugins` self-hosted profile, required services (`takos-app`,
`takosumi`, `takos-git`, `takos-agent`), service health probes, required
bindings, and provider proof tasks.

```sh
deno task validate:distributions

deno task distribution:smoke --manifest deploy/distributions/selfhosted.json
```

The second command is a dry-run unless `--live` or
`TAKOS_DISTRIBUTION_SMOKE_LIVE=1` is set. In dry-run mode it validates the
manifest and prints that live smoke was skipped.

## 2. Run kernel-local proof

Before attaching any live self-host evidence, run the current safe PaaS proof:

```sh
deno run --config deno.json --allow-run=deno --allow-env --allow-read \
  scripts/release-gate.ts --keep-going
```

For a shorter lifecycle smoke:

```sh
deno run --config deno.json --allow-read --allow-env scripts/paas-smoke.ts
```

These commands prove the local/reference kernel surface. They do not prove a
real self-host stack.

## 3. Prepare operator-owned deployment inputs

Use the public template as the contract for the concrete self-host deployment,
but keep the concrete manifest and secrets in the operator/private repo. The
template currently points at `../../takos-private/compose.server.yml` as the
self-host artifact path.

Before live proof, ensure the operator deployment provides:

- immutable service images for `takos-app`, `takosumi`, `takos-git`, and
  `takos-agent`
- target URLs matching the concrete self-host manifest
- Docker/Podman or equivalent process hosting
- reverse proxy routing for public/admin/wildcard domains
- storage, queue/object, KMS, secret-store, router, observability, and
  runtime-agent plugin configuration through the self-hosted provider profile
- target-specific env/credentials required by the external plugin live tasks

Do not treat the template's placeholder hostnames or `:latest` images as
production evidence. Concrete release manifests should pass the stricter
release-mode validator before use.

## 4. Run live distribution health smoke

After the operator-owned self-host stack is deployed and the manifest URLs point
at reachable services, run:

```sh
deno task distribution:smoke \
  --manifest deploy/distributions/selfhosted.json \
  --live
```

This checks the service health probes declared in the manifest. It does not
exercise provider provisioning by itself.

## 5. Run provider plugin proof separately

Provider proof belongs to the external plugin bundle. From the ecosystem root
layout, the self-host manifest advertises:

```sh
cd ../../takosumi && deno task live-smoke:selfhosted

cd ../../takosumi && deno task live-provisioning-smoke:selfhosted
```

Use the fixture and environment variables required by Takosumi
(`@takosumi/plugins`, working tree at `takosumi/`). Keep the live
output with the release/distribution evidence, separate from the kernel docs
lint and local release gate.

## Expected failures and triage

- Template validation fails: fix `deploy/distributions/selfhosted.json` or the
  hosting contract before trying live proof.
- Dry-run smoke passes but `--live` fails: the deployed target URLs are not
  reachable, a service returns a non-200 health response, or expected health
  JSON does not match the manifest.
- Provider live smoke fails: inspect Takosumi (`takosumi/`) credentials, fixture
  values, client injection, and provider endpoint permissions.
- Kernel-local smoke fails: fix the PaaS current surface before treating any
  self-host provider proof as meaningful.
