# Live Backend Proof Plan

> このページでわかること: real backend proof を current commands に分ける方法。

Local source checks and real infrastructure proof are separate. Start with the
source-controlled gates:

```sh
cd takos
bun run check
bun run docs:build
bun run web:build
bun run validate:opentofu-secrets
bun scripts/build-release-manifest.ts
```

Then choose the matching live path:

- Local Docker Compose: `bun run local:config`, `bun run local:up`,
  `bun run local:smoke`, `bun run local:down`
- Cloudflare / self-hosted distribution:
  deploy from the operator/self-hoster environment, then record the matching
  `local:smoke` / browser / provider-run evidence in the private runbook
- Takosumi deploy-control proof: `cd ../takosumi && bun run opentofu:live-local-proof`
  (local plan/apply proof; per-provider provisioning is proven by the deploy-control
  plan/apply/destroy run against the operator Connection / Installation provider connection / policy)
- Public hosted Takosumi Takos:
  run the private operator platform-access status check for the target
  environment/date and attach the resulting evidence ref.

Only the source-controlled gates are CI-equivalent. Live backend proof requires
operator credentials, target URLs, and private evidence refs.

For the Cloudflare target, local-substrate Worker smoke proves the Takosumi
kernel and Takosumi Accounts Worker paths. It does not prove the Takos product
gateway (`takos-worker`) is live on Workers. Use the matching `takosumi-private`
operator evidence, real backend smoke, or browser proof after deploy before
recording Cloudflare `takos-worker` evidence.
