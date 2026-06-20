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

Takos product 側の distribution profile は次で、routing / binding metadata
を含む official distribution artifacts の digest と release manifest evidence
を記録します。

```sh
cd takos
bun scripts/build-release-manifest.ts
```
