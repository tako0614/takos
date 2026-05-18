# takos/website

Landing site for `takos.jp`. It is a SolidStart / Vinxi static prerender app, separate from the Takos docs site under
`docs/`.

Build artifacts are generated under `.output/` and `.vinxi/`; those directories are ignored and should not be committed.

## Build

```sh
npm ci
npm run build
```

## Deploy

```sh
wrangler pages deploy .output/public --project-name takos-landing
```

The docs site deploys from `takos/docs/` to the `takos-docs` Pages project. Keep landing deploys and docs deploys
separate unless an operator explicitly chooses to combine them at the Cloudflare routing layer.

## Local mirror

In local-substrate, Caddy serves the prerendered landing at `https://takos.test/` and docs at
`https://takos.test/docs/`.
