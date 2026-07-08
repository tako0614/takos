# Workspace

> このページでわかること: Takos Workspace の役割と、旧 Space 語彙との違い。

Takos の current product copy では **Workspace** を使います。chat、agent、memory、Git repository、app launcher、MCP
tools をまとめる Takos 内の作業領域です。旧 docs / DB / route 名に残る `space` は Takos product-local な互換語彙であり、
Takosumi の OpenTofu Capsule owner namespace ではありません。

Takosumi Resource Shape API には `Space` がありますが、これは shape namespace / policy scope の語彙です。OpenTofu stack
flow の正本語彙は Workspace / Project / Capsule / Source / ProviderConnection / CredentialRecipe / ProviderBinding / Run /
StateVersion / Output です。

```txt
Takos
  ├─ user Workspace
  ├─ team Workspace
  └─ system Workspace
        └─ installed app / user content
```

Capsule lifecycle の詳細は [Takosumi model](https://takosumi.com/docs/reference/model) を参照。

## Workspace の種類

| kind     | 説明                                                                    |
| -------- | ----------------------------------------------------------------------- |
| `user`   | 個人用 space。ユーザー作成時に自動生成され、UI では personal と表示する |
| `team`   | チーム用 space。複数メンバーで共同利用する                              |
| `system` | システム管理用 space                                                    |

Organization は Workspace kind ではなく membership / billing / policy の上位構造です。大規模な組織利用でも、Takos
Workspace の kind は `user` / `team` / `system` のいずれかに閉じます。

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

Workspace 内で service が使える capability:

`storage.read/write` / `repo.read/write` / `egress.http` / `oauth.exchange` /
`vectorize.write` / `queue.write` / `analytics.write` / `workflow.invoke` /
`durable_object.use` / `billing.meter`

## 課金との関係

Workspace は親 Takosumi Account の billing account
に紐づき、プランに応じたクォータが適用される。請求主体は operator account plane (リファレンス実装: Takosumi Accounts)
/ BillingPort であり、Workspace 単位の usage は Takosumi Account の invoice line
item として集計される。詳しくは [課金](/platform/billing) と
[Takosumi operator model](https://takosumi.com/docs/reference/operator)
を参照。

## 関連ドキュメント

- [Takosumi operator model](https://takosumi.com/docs/reference/operator)
  — Workspace の親 account
- [Capsule Run Ledger](https://takosumi.com/docs/reference/model)
  — Workspace に追加される Capsule の管理台帳
- [Takosumi Capsule Lifecycle](https://takosumi.com/docs/reference/model)
  — Takos Workspace の裏側で Capsule が plan/apply される形
