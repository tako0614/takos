# Self-Host E2E Proof

> このページでわかること: self-host distribution と local Compose の current
> proof。

Self-host static proof uses the distribution profile:

```sh
cd takos
bun run validate:distributions
bun run distribution:smoke --manifest deploy/distributions/selfhosted.json
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

- `takos-worker`
- `takos-git`
- `takos-agent`

Takosumi kernel / Takosumi Accounts are substrate / account-plane services, not
Takos product services.
