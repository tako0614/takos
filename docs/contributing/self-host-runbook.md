# Self-host Distribution Runbook

This runbook covers the current self-host proof path for the current PaaS
surface. Run local validation from `takos`. Treat live self-host execution as
operator-owned evidence: the OSS PaaS repo contains public distribution
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

The second command is a dry-run unless `--live` is set. In dry-run mode it
validates the manifest smoke metadata and prints the service probe URLs without
performing network requests.

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
template currently points at `../takos-private/compose.server.yml` as the
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
cd ../takosumi && \
  TAKOSUMI_PLUGIN_LIVE_PROVIDER=selfhosted \
  TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE=fixtures/live-provisioning/selfhosted.shape-v1.json \
  deno task live-provisioning-smoke

cd ../takosumi && \
  TAKOSUMI_PLUGIN_LIVE_PROVIDER=selfhosted \
  TAKOSUMI_PLUGIN_LIVE_PROOF_MODE=live \
  TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE=fixtures/live-provisioning/selfhosted.shape-v1.json \
  deno task live-provisioning-smoke
```

Use the fixture and environment variables required by Takosumi
(`@takosumi/plugins`, working tree at `takosumi/`). Keep the live output with
the release/distribution evidence, separate from the kernel docs lint and local
release gate.

## Takosumi Accounts self-host setup (Phase 1.1+)

Installable App Model (ROADMAP.md Phase 1.1-1.7) 完了以降、self-host operator は
Takos 単体の deploy に加えて **Takosumi Accounts** (identity / billing plane)
を立ち上げる必要があります。Takos 自身は OIDC consumer として動作する
ため、operator は次の構成を用意します:

- 同一 takosumi instance 上で `takosumi-cloud/accounts` を deploy し、
  `accounts.<your-domain>` を OIDC issuer URL として供給する
- 既存の外部 OIDC issuer (Keycloak / Authentik / Auth0 / Clerk / Supabase Auth /
  custom OIDC) を使う場合も、Takosumi Accounts の upstream IdP として broker
  する。Takos runtime が直接外部 issuer を consume して AppInstallation /
  billing / launch-token 経路を迂回する構成は canonical self-host path ではない

operator が用意する binding 設定:

- **per-installation OIDC client provisioning**: AppInstallation ごとの OIDC
  client は AppBinding (`identity.oidc@v1`) として takosumi-git 経由で注入
  される。手動 provisioning する場合は client_id / client_secret / redirect_uris
  を AppBinding template に書き込み、Takos runtime env (`OIDC_CLIENT_ID` /
  `OIDC_CLIENT_SECRET` / `OIDC_REDIRECT_URI`) として resolve する。
- **launch token JWS signing key**: install 直後の bootstrap
  (`/_takosumi/launch`) で使う short-lived JWS の signing key は Takosumi
  Accounts が保持する。Takos には `INSTALL_LAUNCH_PUBLIC_KEY` のみ渡す。

### Launch token JWS signing key rotation runbook

1. Takosumi Accounts 側で新しい signing key pair を生成し、JWKS の active key
   set に **追加** する (旧 key は verify 用に保持)。
2. AppInstallation の `INSTALL_LAUNCH_PUBLIC_KEY` を rotated key reference に
   差し替え、AppBinding を再 publish する (Takos runtime env reload)。
3. rotation grace window 経過後、旧 key を JWKS active set から外す。
4. AppInstallation `installation_event` に rotation 完了を記録し、Takosumi
   Accounts の audit log と一致させる。

self-host でも Takosumi Accounts を運用してください。launch token /
AppInstallation ledger / billing owner を無効化して Takos の通常 OIDC login
だけで運用する形は、 Installable App Model の所有権 chain を失うため production
target ではありません。

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
