# Router Config Proof

> このページでわかること: router config contract の current proof。

Router config は Takos product script ではなく、Takosumi contract / kernel の
port と deployment tests で検証します。

```sh
cd ../takosumi
deno test --allow-all \
  packages/contract/src/plugin-sdk_test.ts \
  packages/kernel/src/domains/deploy/plan_apply_test.ts
```

Takos product 側の distribution profile は次で、routing / binding metadata
を含む official manifests を検証します。

```sh
cd takos
bun run validate:distributions
bun run distribution:smoke
```
