# Workspace / Space

Takos の最上位の隔離単位は `Space` です。利用者向け surface では `Workspace` という語が残る場面がありますが、概念としては同じ境界を指します。

## 何を隔離するか

Workspace / Space は、少なくとも次をまとめて管理します。

- member と role
- repo
- worker / service
- resource
- thread / run
- files (space storage)
- store registry (パッケージ発見)

## Space の種類

| kind | 説明 |
| --- | --- |
| `user` | 個人用 space。ユーザー作成時に自動生成される personal space |
| `team` | チーム用 space。複数メンバーでの共同利用 |
| `system` | システム管理用 space |

Personal space は `GET /api/me/personal-space` で取得できます。Space は ID の他に一意な `slug` を持ち、API では ID または slug で参照できます（`/api/spaces/me` で personal space を指す shortcut もあります）。

## role

Takos の membership role は次です。権限は数値レベルで管理され、「指定レベル以上」で判定されます。

| role | level | 説明 |
| --- | --- | --- |
| `owner` | 4 | space の所有者。全操作が可能 |
| `admin` | 3 | 管理者。member 管理、deploy、resource 操作が可能 |
| `editor` | 2 | 編集者。コンテンツの作成・編集が可能 |
| `viewer` | 1 | 閲覧者。読み取りのみ |

## Principal

membership の主体は `Principal` です。ユーザーだけでなく、agent や service も principal として space 内で操作できます。

| kind | 説明 |
| --- | --- |
| `user` | 人間のユーザー |
| `space_agent` | space に紐づく AI agent |
| `service` | deploy された service |
| `system` | システム |
| `tenant_worker` | tenant worker |

## Security posture

Space は security posture を持ちます。

| posture | 説明 |
| --- | --- |
| `standard` | 通常のアクセス制御 |
| `restricted_egress` | 外向き通信を制限する |

## AI model 設定

Space ごとに AI agent が使用するモデルとプロバイダーを設定できます。

- `ai_model` — 使用するモデル名
- `ai_provider` — モデルプロバイダー

## Capability

Space 内で service が使える capability は次のとおりです。

| capability | 説明 |
| --- | --- |
| `storage.read` / `storage.write` | space storage へのアクセス |
| `repo.read` / `repo.write` | repository へのアクセス |
| `egress.http` | 外向き HTTP 通信 |
| `oauth.exchange` | OAuth トークン交換 |
| `vectorize.write` | vector index への書き込み |
| `queue.write` | queue への書き込み |
| `analytics.write` | analytics dataset への書き込み |
| `workflow.invoke` | workflow の起動 |
| `durable_object.use` | Durable Object の利用 |
| `billing.meter` | 使用量メーターへの書き込み |

## Space 作成時の動作

Space が作成されると、デフォルトの repository が自動的に作成されます。

## Billing との関係

Space のユーザーは billing account に紐づき、プラン (Free / Plus / PayG) に応じたクォータが適用されます。詳しくは [課金アーキテクチャ](/platform/billing) を参照してください。

## public と internal の違い

利用者向け surface では `workspace` という名前が残ります。
内部モデルや一部の型では `space` が canonical です。docs では混乱を避けるため、`Workspace / Space` と併記します。
