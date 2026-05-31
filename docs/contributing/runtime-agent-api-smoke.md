# Runtime Agent API Proof

> このページでわかること: runtime-agent API の current proof。

Runtime-agent API は Takosumi kernel / runtime-agent packages の contract です。
Takos product docs からは、次の Takosumi tests を参照します。

```sh
cd ../takosumi
deno test --allow-all \
  packages/kernel/src/api/runtime_agent_routes_test.ts \
  packages/runtime-agent/src/server_test.ts \
  packages/all/tests/e2e_deploy_test.ts
```

Takos product の agent 実行面は `takos/containers/agent` と `takos-agent-engine` の tests
で扱います。product release gate では次を起点に確認します。

```sh
cd takos
deno task release-gate
```
