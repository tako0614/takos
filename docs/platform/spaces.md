# Space

**Space は
[Takosumi Account](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
の子です。** Takos の最上位の隔離単位として、member、repo、worker、resource、thread、files をまとめて管理しますが、Space
自体の所有者・契約主体・billing owner は Takosumi Account 側にあります。

所有構造:

```txt
Takosumi Account
  ├─ personal Space (kind: personal)
  └─ team Spaces  (kind: team / org)
        └─ AppInstallation (e.g. example.notes)
              └─ Space-scoped resources
```

つまり `Takosumi Account → Space → AppInstallation` の 3 階層が正本であり、Space は AppInstallation
の親として機能します。AppInstallation の詳細は
[App Installation Ledger](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/app-installation.md)
を参照。

## Space の種類

| kind       | 説明                                                                |
| ---------- | ------------------------------------------------------------------- |
| `personal` | 個人用 space。ユーザー作成時に自動生成 (canonical: glossary §Space) |
| `team`     | チーム用 space。複数メンバーで共同利用                              |
| `org`      | 組織用 space。複数 team / 大規模 membership 向け                    |
| `system`   | システム管理用 space                                                |

`personal` は Installable App Model の canonical enum です。移行期間中の Takos app API / client code が legacy `user`
を返す場合は `personal` に normalize して扱い ます。新規 docs / API contract では `user` を増やしません。

Personal space は `GET /api/me/personal-space` で取得。`slug` で一意に識別でき、`/api/spaces/me` で personal space
を指す shortcut もある。

## Role

| role     | level | 説明                               |
| -------- | ----- | ---------------------------------- |
| `owner`  | 4     | 全操作が可能                       |
| `admin`  | 3     | member 管理、deploy、resource 操作 |
| `editor` | 2     | コンテンツの作成・編集             |
| `viewer` | 1     | 読み取りのみ                       |

## Principal

membership の主体。ユーザーだけでなく agent や service も principal として操作できる。

| kind            | 説明                  |
| --------------- | --------------------- |
| `user`          | 人間のユーザー        |
| `space_agent`   | AI agent              |
| `service`       | deploy された service |
| `system`        | システム              |
| `tenant_worker` | tenant worker         |

## Capability

Space 内で service が使える capability:

`storage.read/write` / `repo.read/write` / `egress.http` / `oauth.exchange` / `vectorize.write` / `queue.write` /
`analytics.write` / `workflow.invoke` / `durable_object.use` / `billing.meter`

## 課金との関係

Space は親 Takosumi Account の billing account に紐づき、プランに応じたクォータが適用される。請求主体は operator の
Takosumi Accounts / BillingPort であり、Space 単位の usage は Takosumi Account の invoice line item
として集計される。詳しくは [課金](/platform/billing) と
[Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
を参照。

## 関連ドキュメント

- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md) —
  Space の親 account
- [App Installation Ledger](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/app-installation.md) —
  Space に install される AppInstallation の正本
- [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  — Takos が Space に install される形
- [Runtime Modes](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/runtime-modes.md) — Space ごとの
  runtime mode (shared-cell / dedicated / self-hosted)
