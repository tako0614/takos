# Self-Host E2E Proof

> このページでわかること: self-host distribution と local Compose の current proof。

Self-host static proof uses the distribution profile:

```sh
cd takos
deno task validate:distributions
deno task distribution:smoke --manifest deploy/distributions/selfhosted.json
```

実 Docker Compose proof は operator-owned local evidence です。

```sh
cd takos
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:config
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:up
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:smoke
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:down
```

`deno task local:up` は foreground で動きます。別 shell で smoke を走らせ、
検証後に `local:down` で停止します。

## Expected Product Services

- `takos-app`
- `takos-git`
- `takos-agent`

Takosumi kernel / Takosumi Accounts are substrate / account-plane services, not
Takos product services.
