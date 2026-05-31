# Local Compose Smoke

> このページでわかること: Takos local Compose stack の current smoke。

Takos local stack は `compose.local.yml` と `bun run local:*` を使います。

## Static config

```sh
cd takos
bun run local:config
```

## Start / smoke / stop

```sh
cd takos
bun run local:up
bun run local:smoke
bun run local:down
```

実行時の env file は `TAKOS_LOCAL_ENV_FILE` で差し替えます。Docker / Compose
実行は operator-owned local proof であり、CI-equivalent な release proof
とは分けて扱います。
