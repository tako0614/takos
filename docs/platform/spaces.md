# Space

> このページでわかること: Space の役割と種類。

Space は Takosumi Account の下に作る作業領域です。メンバー、リポジトリ、アプリ、スレッド、
ファイルをまとめて管理します。

```txt
Takosumi Account
  ├─ personal Space
  └─ team / org Space
        └─ AppInstallation (例: example.notes)
```

`Account → Space → AppInstallation` の 3 階層になっています。
AppInstallation の詳細は
[App Installation Ledger](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
を参照。

## Space の種類

| kind       | 説明                                             |
| ---------- | ------------------------------------------------ |
| `personal` | 個人用 space。ユーザー作成時に自動生成           |
| `team`     | チーム用 space。複数メンバーで共同利用           |
| `org`      | 組織用 space。複数 team / 大規模 membership 向け |
| `system`   | システム管理用 space                             |

Personal space は `GET /api/me/personal-space` で取得。`slug`
で一意に識別でき、`/api/spaces/me` で personal space を指す shortcut もある。

## Role

| role     | level | 説明                               |
| -------- | ----- | ---------------------------------- |
| `owner`  | 4     | 全操作が可能                       |
| `admin`  | 3     | member 管理、deploy、resource 操作 |
| `editor` | 2     | コンテンツの作成・編集             |
| `viewer` | 1     | 読み取りのみ                       |

## Principal

membership の主体。ユーザーだけでなく agent や service も principal
として操作できる。

| kind            | 説明                  |
| --------------- | --------------------- |
| `user`          | 人間のユーザー        |
| `space_agent`   | AI agent              |
| `service`       | deploy された service |
| `system`        | システム              |
| `tenant_worker` | tenant worker         |

## Capability

Space 内で service が使える capability:

`storage.read/write` / `repo.read/write` / `egress.http` / `oauth.exchange` /
`vectorize.write` / `queue.write` / `analytics.write` / `workflow.invoke` /
`durable_object.use` / `billing.meter`

## 課金との関係

Space は親 Takosumi Account の billing account
に紐づき、プランに応じたクォータが適用される。請求主体は operator account plane
/ BillingPort であり、Space 単位の usage は Takosumi Account の invoice line
item として集計される。 詳しくは [課金](/platform/billing) と
[Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
を参照。

## 関連ドキュメント

- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  — Space の親 account
- [App Installation Ledger](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
  — Space に install される AppInstallation の管理台帳
- [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  — Takos が Space に install される形
- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md)
  — Space ごとの runtime mode (shared-cell / dedicated / self-hosted)
