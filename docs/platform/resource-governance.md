# Resource Governance

Takos の resource governance は、**resource CRUD + access control + runtime settings + billing gates**
の組み合わせで成立しています。

## 管理対象

Takos は次の面を別々に管理します。

- resource 自体の CRUD
- space/service/worker への access grant
- connection info の参照
- common env / binding link
- runtime setting / limit
- app-local usage metering と Accounts billing 連携

## current control points

### resources

`/api/resources` family が resource 基準です。

- resource CRUD
- access grant (`/access`)
- connection info (`/connection`)
- sql introspection / query / export (backend example: D1)
- object-store object list / stats / delete (backend example: R2)
- bind / unbind

### common env と bindings

state は次に分かれています。

- space-level common env
- service common env links
- worker common env links
- service bindings
- worker bindings

これにより「resource を持つこと」と「どこへ注入するか」を分離しています。

### runtime settings

service / worker ごとに runtime setting, limit, flag を持てます。operator が調整する主な対象は次です。

- hostname / route
- common env links
- resource bindings
- runtime flags / settings / limits

## billing gate

current implementation では request path ごとに billing/plan gate をかけています。

| gate                            | path family                                                        |
| ------------------------------- | ------------------------------------------------------------------ |
| vector search                   | `/api/spaces/:spaceId/search*`                                     |
| embeddings / index              | `/api/spaces/:spaceId/index*`                                      |
| sessions exec time              | `/api/sessions*`                                                   |
| service / WFP usage             | `/api/services*`                                                   |
| agent runtime + token preflight | `/api/spaces/:spaceId/threads*`, `/api/runs*`, `/api/agent-tasks*` |

agent 系は特に次を併用します。

- weekly runtime limit
- token input billing gate

## usage / billing data model

Takos app は app-local usage を記録し、請求主体は Takosumi Accounts (`operator.billing.default`) に置きます。Takos app
側の current table は 主に次です。

- `app_usage_events`
- `app_usage_rollups`

canonical billing API は Takosumi Accounts の `operator.billing.default` BillingPort です。consumer は account API
が返す billing endpoint に request を送り、`/v1/billing/usage` で current billing account の usage rollup
を取得します。Takos の `/api/billing/*` と `/api/internal/v1/billing/*` は current API ではなく、apps/api gateway では
retired compatibility response として `410 Gone` を返します。

## operator が見るべき state

- resource inventory
- access grants / AppBinding credentials
- common env drift
- service / worker runtime settings
- usage rollup
- billing status

詳しい public path は [API リファレンス](/reference/api) を参照してください。billing の詳細は
[Billing](/platform/billing) を参照してください。
