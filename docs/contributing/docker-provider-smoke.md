# Docker / Self-Host Proof

> このページでわかること: Docker self-host path の current proof。

Takos product の Docker proof は portable product check と local Compose
で扱います。

```sh
cd takos
bun run local:config
bun run check
```

実 Docker 起動を伴う proof は operator local evidence です。

```sh
cd takos
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:up
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:smoke
TAKOS_LOCAL_ENV_FILE=.env.local bun run local:down
```

任意の OpenTofu/Terraform provider を使う live provisioning proof は
`takosumi/` の Capsule plan / apply / destroy Run
(ProviderConnection / ProviderBinding / policy) で扱います。Takos
repository は credential 注入や provider 実行を行いません。
