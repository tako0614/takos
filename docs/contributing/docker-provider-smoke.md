# Docker / Self-Host Proof

> このページでわかること: Docker self-host path の current proof。

Takos product の Docker proof は local Compose と self-host distribution smoke
で扱います。

```sh
cd takos
deno task local:config
deno task distribution:smoke --manifest deploy/distributions/self-hosted.json
```

実 Docker 起動を伴う proof は operator local evidence です。

```sh
cd takos
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:up
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:smoke
TAKOS_LOCAL_ENV_FILE=.env.local deno task local:down
```

Takosumi provider-specific live provisioning proof は `takosumi/` の
`live-provisioning-smoke` と provider fixture で扱います。
