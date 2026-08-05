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
https://app.takosumi.com/install?git=<takos-git-url>&ref=<ref>&path=<module-path>
```

Defaults are production-safe once the named GitHub release is immutable because
the source fallback is an immutable release tag or full commit. Release builds
must pin the ref to the release tag or commit they are publishing, and the tag
must exist before this website is deployed:

```sh
VITE_TAKOS_INSTALL_GIT_URL=https://github.com/tako0614/takos.git
VITE_TAKOS_INSTALL_REF=v1.0.0
VITE_TAKOS_INSTALL_MODULE_PATH=deploy/opentofu/takoform
```

The default public link also includes `name=takos` and
`var.project_name=takos`. It contains no provider-specific input. Takosumi
resolves the selected Takoform host and its connection through the ordinary
ProviderBinding flow. A direct Cloudflare install is a separate module choice
and receives Cloudflare inputs from that module's install form.

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
