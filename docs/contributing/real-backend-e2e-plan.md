# Live Backend Proof Plan

> このページでわかること: real backend proof を current commands に分ける方法。

Local source checks and real infrastructure proof are separate. Start with the
source-controlled gates:

```sh
cd takos
bun run check
```

Then choose the matching live path:

- Local Docker Compose: `bun run local:config`, `bun run local:up`,
  `bun run local:smoke`, `bun run local:down`
- Cloudflare / self-hosted distribution:
  deploy only to an environment owned by that operator/self-hoster, then record the matching
  `local:smoke` / browser / provider-run evidence in the private runbook
- Takosumi deploy-control proof: `cd ../takosumi && bun run opentofu:live-local-proof`
  (local plan/apply proof; per-provider provisioning is proven by the deploy-control
  plan/apply/destroy run against the operator ProviderConnection / ProviderBinding / policy)
- Public hosted operator evidence for Takos:
  run the private operator platform-access status check for the target
  environment/date and attach the resulting evidence ref.

Only the source-controlled gates are CI-equivalent. Live backend proof requires
operator credentials, target URLs, and private evidence refs.
Artifact publication and hosted production deployment are not run from this
proof plan; they use the owning repository's deploy entrypoint.

For the Cloudflare target, local-substrate Worker smoke proves the Takosumi
kernel and Takosumi Accounts Worker paths. It does not prove the Takos product
gateway (`takos-worker`) is live on Workers. Use the matching `takosumi-private`
operator evidence, real backend smoke, or browser proof after an explicitly
an authorized self-host deployment or deploy before recording
Cloudflare `takos-worker` evidence.
