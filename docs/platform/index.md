# Takos の概念

> このページでわかること: Takos の利用者として知っておくべき概念の一覧。

## 基本概念

| 概念                                      | 説明                                                                            |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| [Space](./spaces.md)                      | chat / agent / memory / installed apps をまとめる作業単位。                     |
| [Threads and Runs](./threads-and-runs.md) | conversation と agent execution の基本モデル。                                  |
| [Store](./store.md)                       | Takos product feature としての app discovery / catalog。                        |
| [Bundled Apps](./default-apps.md)         | 新規 space に bundle される takos-docs / slide / excel / computer / yurucommu。 |
| [Billing](./billing.md)                   | Takos から見える billing UX と Takosumi Accounts への接続。                     |
| [Upgrade / Export](./upgrade-export.md)   | install 済み app の upgrade / rollback / self-host export。                     |

## バンドルアプリ

- [takos-docs](./takos-docs.md)
- [takos-slide](./takos-slide.md)
- [takos-excel](./takos-excel.md)
- [takos-computer](./takos-computer.md)
- [yurucommu](./yurucommu.md)

## 関連

| 内容                                                 | 詳細ドキュメント                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Takosumi Installation Lifecycle / Installation / runtime modes | [ecosystem platform docs](https://github.com/tako0614/takos-ecosystem/tree/master/docs/platform) |
| AppSpec / Installation / Deployment                  | [Core Specification](https://takosumi.com/docs/reference/core-spec)                              |
| OIDC issuer / billing owner / launch token           | [Takosumi Cloud entry point](https://takosumi.com/docs/reference/takosumi-cloud)                 |
| `.takosumi.yml` AppSpec convention                   | [AppSpec reference](https://takosumi.com/docs/reference/app-spec)                                |
