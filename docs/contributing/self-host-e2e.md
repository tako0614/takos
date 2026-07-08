# Self-Host E2E Proof

> このページでわかること: self-host distribution と local Compose の current
> proof。

Self-host static proof uses the current local release evidence:

```sh
cd takos
bun run check
bun run validate:opentofu-secrets
bun scripts/build-release-manifest.ts
```

実 Docker Compose proof は operator-owned local evidence です。

```sh
cd takos
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:config
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:up
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:smoke
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:down
```

`bun run local:up` は foreground で動きます。別 shell で smoke を走らせ、
検証後に `local:down` で停止します。

## Expected Product Services

- `takos-worker` (serves worker-native Git Smart HTTP)
- `takos-agent`

Takosumi kernel / Takosumi Accounts are substrate / account-plane services, not
Takos product services.
