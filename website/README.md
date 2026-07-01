# takos/website

Landing site for `takos.jp`. It is a SolidStart / Vinxi static prerender app, separate from the Takos docs site under
`docs/`.

Build artifacts are generated under `.output/` and `.vinxi/`; those directories are ignored and should not be committed.

## Build

```sh
npm ci
npm run build
```

## Takosumi Install Links

The primary CTA resolves to the Takosumi platform worker install prefill route:

```txt
https://app.takosumi.com/install?git=<takos-git-url>&ref=<ref>&path=<module-path>&varjson.cloudflare={}
```

Defaults are production-safe as a working fallback because the source fallback
is an immutable commit. GA/release builds should still pin the ref to the
release tag or commit they are publishing:

```sh
VITE_TAKOS_INSTALL_GIT_URL=https://github.com/tako0614/takos.git
VITE_TAKOS_INSTALL_REF=v1.0.0
VITE_TAKOS_INSTALL_MODULE_PATH=deploy/opentofu
VITE_TAKOS_INSTALL_WORKERS_SUBDOMAIN=<optional-workers-dev-subdomain>
```

The default public link also includes `name=takos`, `var.project_name=takos`,
and `varjson.cloudflare={}`. Those are ordinary OpenTofu inputs for
`deploy/opentofu`; they tell Takosumi to pass the selected Cloudflare Provider
Connection's account hint into the module instead of Takosumi inventing a
hidden deployment path. If `VITE_TAKOS_INSTALL_WORKERS_SUBDOMAIN` is set, the
link also includes `var.cloudflare.workers_subdomain` so the OpenTofu module can
derive a launch URL.

`VITE_CLOUD_HOME_URL`, `VITE_CLOUD_USE_TAKOS_URL`, and
`VITE_CLOUD_INSTALL_URL` can override the full Takosumi URLs when an operator
needs a staging platform worker. Keep production public links on the bare
platform origin `https://app.takosumi.com`; do not use retired accounts or
deploy-control subdomains.

## Deploy

```sh
wrangler pages deploy .output/public --project-name takos-landing
```

Production custom domains for this Pages project are:

```txt
takos.jp
www.takos.jp
```

Both domains must be registered under the `takos-landing` Pages project and
their DNS records should point at `takos-landing.pages.dev`. The public CTA must
continue to resolve to `https://app.takosumi.com/install?...` with a release tag
or commit SHA, not a moving ref such as `main`.

The docs site deploys from `takos/docs/` to the `takos-docs` Pages project. Keep landing deploys and docs deploys
separate unless an operator explicitly chooses to combine them at the Cloudflare routing layer.

## Local mirror

In local-substrate, Caddy serves the prerendered landing at `https://takos.test/` and docs at
`https://takos.test/docs/`.
