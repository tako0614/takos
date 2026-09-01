# Router Config Proof

> このページでわかること: router config contract の current proof。

Router config は Takos product script ではなく、Takosumi contract / kernel の
port と deployment tests で検証します。

```sh
cd ../takosumi
bun test \
  core/api/deploy_control_deploy_routes_test.ts \
  core/api/deploy_control_source_routes_test.ts \
  core/api/deploy_control_connection_routes_test.ts \
  core/api/deploy_control_model_routes_test.ts
```

Takos product側のdistribution metadataのsource整合性はportable gateで検証します。

```sh
cd takos
bun run check
```

変更不可の candidateのdigestは、公式release時に`takos-control`のRelease
deploy entrypoint の owner gate が生成・固定します。
