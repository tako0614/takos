# Takos Product Concepts

この章は Takos product の利用者が見る Takos/Takosumi concepts
をまとめます。Takosumi kernel や Takosumi Accounts
の内部仕様はここでは扱いません。

## Takos 側の概念

| 概念                                      | 説明                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| [Space](./spaces.md)                      | chat / agent / memory / installed apps をまとめる作業単位。                     |
| [Threads and Runs](./threads-and-runs.md) | conversation と agent execution の基本モデル。                                  |
| [Store](./store.md)                       | Takos product feature としての app discovery / catalog。                        |
| [Bundled Apps](./default-apps.md)         | 新規 space に bundle される takos-docs / slide / excel / computer / yurucommu。 |
| [Billing](./billing.md)                   | Takos から見える billing UX と Takosumi Accounts への接続。                     |
| [Upgrade / Export](./upgrade-export.md)   | install 済み app の upgrade / rollback / self-host export。                     |

## bundled app

- [takos-docs](./takos-docs.md)
- [takos-slide](./takos-slide.md)
- [takos-excel](./takos-excel.md)
- [takos-computer](./takos-computer.md)
- [yurucommu](./yurucommu.md)

## 外部仕様

| 内容                                                    | 正本                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Installable App Model / AppInstallation / runtime modes | [ecosystem platform docs](https://github.com/tako0614/takos-ecosystem/tree/master/docs/platform) |
| kernel deploy / Shape resources                         | [takosumi docs](https://github.com/tako0614/takosumi/tree/master/docs)                           |
| OIDC issuer / billing owner / launch token              | [takosumi-cloud docs](https://github.com/tako0614/takosumi-cloud/tree/master/docs)               |
| `.takosumi/` project convention                         | [takosumi-git docs](https://github.com/tako0614/takosumi-git/tree/master/docs)                   |
