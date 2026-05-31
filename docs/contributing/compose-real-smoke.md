# Real Compose Proof

> このページでわかること: Docker Compose を実際に起動する local proof。

実 Docker / Compose proof は明示的に operator が動かす local evidence です。
Takos product root の current commands は次です。

```sh
cd takos
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:config
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:up
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:smoke
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:down
```

`bun run local:up` は foreground で動くため、別 shell で `local:smoke`
を実行します。 stack を残して調査する場合は `local:down`
を後で実行してください。
