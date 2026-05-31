# Live Backend Proof Plan

> このページでわかること: real backend proof を current commands に分ける方法。

Local source checks and real provider proof are separate. Start with the
source-controlled gates:

```sh
cd takos
bun run check
bun run validate:distributions
bun run distribution:smoke
```

Then choose the matching live path:

- Local Docker Compose: `bun run local:config`, `bun run local:up`,
  `bun run local:smoke`, `bun run local:down`
- Cloudflare / AWS / GCP / Kubernetes / self-hosted distribution:
  `bun run distribution:smoke --manifest deploy/distributions/<target>.json --live`
- Takosumi provider fixture:
  `cd ../takosumi && TAKOSUMI_PLUGIN_LIVE_PROVIDER=<target> TAKOSUMI_PLUGIN_LIVE_PROOF_FIXTURE_FILE=<fixture> deno task live-provisioning-smoke`
- Public managed Takos:
  `cd ../takos-private && deno task managed-offering:status -- --environment <env> --date <YYYY-MM-DD>`

Only the source-controlled gates are CI-equivalent. Live backend proof requires
operator credentials, target URLs, and private evidence refs.

For the Cloudflare target, local-substrate Worker smoke proves the Takosumi
kernel and Takosumi Accounts Worker paths. It does not prove the Takos product
gateway (`takos-worker`) is live on Workers. Use `distribution:smoke --live` after
deploy, or the matching `takos-private` real backend smoke, before recording
Cloudflare `takos-worker` evidence.
