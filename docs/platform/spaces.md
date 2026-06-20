# Space

> このページでわかること: Space の役割と種類。

このページの Space は **Takos product space** です。chat、agent、memory、Git repository、app launcher、MCP tools をまとめる
Takos 内の作業領域で、Takosumi Space (`@handle` の Capsule owner namespace) とは別概念です。

```txt
Takos
  ├─ user product space
  ├─ team product space
  └─ system product space
        └─ bundled app / user content
```

OpenTofu Capsule Installation の owner namespace は Takosumi Space です。Capsule Installation の詳細は
[Takosumi model](https://takosumi.com/docs/reference/model) を参照。

## Space の種類

| kind     | 説明                                                                   |
| -------- | ---------------------------------------------------------------------- |
| `user`   | 個人用 space。ユーザー作成時に自動生成され、UI では personal と表示する |
| `team`   | チーム用 space。複数メンバーで共同利用する                             |
| `system` | システム管理用 space                                                   |

Organization は `SpaceKind` ではなく membership / billing / policy の上位構造です。大規模な組織利用でも、Takos product
space の kind は `user` / `team` / `system` のいずれかに閉じます。

Personal space は `GET /api/me/personal-space` で取得。`slug` で一意に識別でき、`/api/spaces/me` で personal space を指す
shortcut もある。

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
に紐づき、プランに応じたクォータが適用される。請求主体は operator account plane (リファレンス実装: Takosumi Accounts)
/ BillingPort であり、Space 単位の usage は Takosumi Account の invoice line
item として集計される。詳しくは [課金](/platform/billing) と
[Takosumi operator model](https://takosumi.com/docs/reference/operator)
を参照。

## 関連ドキュメント

- [Takosumi operator model](https://takosumi.com/docs/reference/operator)
  — Space の親 account
- [App Installation Ledger](https://takosumi.com/docs/reference/model)
  — Space に install される Installation の管理台帳
- [Takosumi Installation Lifecycle](https://takosumi.com/docs/reference/model)
  — Takos が Space に install される形
