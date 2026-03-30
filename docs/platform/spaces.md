# Workspace / Space

Takos の最上位の隔離単位。member、repo、worker、resource、thread、files をまとめて管理する。

## Space の種類

| kind | 説明 |
| --- | --- |
| `user` | 個人用 space。ユーザー作成時に自動生成 |
| `team` | チーム用 space。複数メンバーで共同利用 |
| `system` | システム管理用 space |

Personal space は `GET /api/me/personal-space` で取得。`slug` で一意に識別でき、`/api/spaces/me` で personal space を指す shortcut もある。

## Role

| role | level | 説明 |
| --- | --- | --- |
| `owner` | 4 | 全操作が可能 |
| `admin` | 3 | member 管理、deploy、resource 操作 |
| `editor` | 2 | コンテンツの作成・編集 |
| `viewer` | 1 | 読み取りのみ |

## Principal

membership の主体。ユーザーだけでなく agent や service も principal として操作できる。

| kind | 説明 |
| --- | --- |
| `user` | 人間のユーザー |
| `space_agent` | AI agent |
| `service` | deploy された service |
| `system` | システム |
| `tenant_worker` | tenant worker |

## Capability

Space 内で service が使える capability:

`storage.read/write` / `repo.read/write` / `egress.http` / `oauth.exchange` / `vectorize.write` / `queue.write` / `analytics.write` / `workflow.invoke` / `durable_object.use` / `billing.meter`

## 課金との関係

Space のユーザーは billing account に紐づき、プランに応じたクォータが適用される。詳しくは [課金](/platform/billing) を参照。
