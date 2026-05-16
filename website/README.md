# takosumi/website

Marketing landing for `takosumi.com`. Vanilla HTML + CSS, no build step,
no runtime dependencies. Ships as a Cloudflare Pages project alongside
the docs (which mount under `/docs/`).

## Deploy

```sh
wrangler pages deploy takosumi/website --project-name takosumi-landing
```

Then in the Cloudflare dashboard, add `takosumi.com` (apex) as a custom
domain. The docs Pages project (`takosumi-docs`) attaches at
`takosumi.com/docs/` via Pages' base-path routing or via a separate
project with the same custom domain and different path matcher.

For a single-project deploy, copy `takosumi/docs/.vitepress/dist/`
under `takosumi/website/docs/` before `wrangler pages deploy
takosumi/website` so Pages serves both from one project.

## Local mirror

In the local-substrate (`takos/deploy/local-substrate/`), Caddy serves
this directory at `https://takosumi.test/` and the docs at
`https://takosumi.test/docs/`. See
`takos/deploy/local-substrate/docs/production-deploy-cloudflare.md`.
