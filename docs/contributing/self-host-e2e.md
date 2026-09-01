# Self-Host E2E Proof

> このページでわかること: self-host distribution と local Compose の current
> proof。

Self-host static proof uses the portable source gate:

```sh
cd takos
bun run check
```

実 Docker Compose proof は operator-owned local evidence です。
これらのlocal commandはdeployやproduction mutationを許可しません。verified
self-host distributionのpublicationはowning repositoryのdeploy entrypoint、
利用者環境へのdeploymentはself-hoster自身のauthorityです。

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

- `takos-worker` (preserves legacy Git data while its built-in migration compatibility route remains quarantined fail-closed)
- `takos-agent`

Takosumi kernel / Takosumi Accounts are 実行基盤 / account-plane services, not
Takos product services.
