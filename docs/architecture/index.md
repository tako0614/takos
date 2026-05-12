# アーキテクチャ

この章は Takos product の構造を説明します。Takosumi kernel、Takosumi Accounts、 takosumi-git の詳細仕様は、それぞれの
repository docs を正本にします。

## まず読むページ

- [System Architecture](./system-architecture.md) — Takos product と sibling product の境界。
- [Service Topology](./service-topology.md) — Takos app / git / agent / bundled apps の関係。
- [App Publications](./app-publications.md) — Takos app metadata と deploy manifest の境界。
- [Runtime / Agent](./runtime-service.md) — runtime execution と agent service の分担。
- [Diagrams](./diagrams.md) — 図で全体像を確認するページ。

## この章で扱うこと

- Takos product が提供する user-facing feature: AI agents / Git / memory / spaces / tools / chat / Store。
- Takos service set: `takos-app` / `takos-git` / `takos-agent`。
- bundled app の扱い: takos-docs / takos-slide / takos-excel / takos-computer / yurucommu。
- Takos が external platform surface と接続する点: OIDC consumer、AppBinding、compiled manifest deploy。

## この章で扱わないこと

| 内容                                                    | 正本                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Installable App Model / AppInstallation / runtime modes | [ecosystem docs](https://github.com/tako0614/takos-ecosystem/tree/master/docs/platform) |
| Takosumi Accounts / billing / OIDC issuer               | [takosumi-cloud docs](https://github.com/tako0614/takosumi-cloud/tree/master/docs)      |
| takosumi kernel / Shape manifest / kernel HTTP API      | [takosumi docs](https://github.com/tako0614/takosumi/tree/master/docs)                  |
| `.takosumi/` convention / Git URL install / workflowRef | [takosumi-git docs](https://github.com/tako0614/takosumi-git/tree/master/docs)          |
| production deploy runbook / secrets                     | [takos-private docs](https://github.com/tako0614/takos-private/tree/master/docs)        |

Takos docs から外部仕様を説明するときは、ここに概要だけ置き、詳細は owning docs にリンクします。
