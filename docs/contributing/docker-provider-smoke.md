# Docker / Self-Host Proof

> このページでわかること: Docker self-host path の current proof。

Takos product の Docker proof は local Compose と release manifest evidence
で扱います。

```sh
cd takos
bun run local:config
bun scripts/build-release-manifest.ts
```

実 Docker 起動を伴う proof は operator local evidence です。

```sh
cd takos
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:up
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:smoke
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:down
```

Takosumi provider-specific live provisioning proof は `takosumi/` の deploy-control
plan / apply / destroy run (Connection / Installation provider connection / policy) で扱います。local deploy-control proof は
`cd takosumi && bun run opentofu:live-local-proof` です。
