# リソースガバナンス

> このページでわかること: Takos のリソース管理・アクセス制御・課金連携の仕組み。

リソースガバナンスは、リソースの
CRUD、アクセス制御、ランタイム設定、課金ゲートの組み合わせで構成されています。

## 管理対象

Takos は次の面を別々に管理します。

- リソース自体の CRUD
- space / service / worker への access grant
- 接続情報の参照
- common env / binding link
- ランタイム設定 / リミット
- app-local の usage 計測と Accounts billing 連携

## コントロールポイント

### リソース

`/api/resources` がリソース操作の基点です。

- リソースの CRUD
- access grant (`/access`)
- 接続情報 (`/connection`)
- SQL の introspection / query / export (例: D1 バックエンド)
- オブジェクトストアの一覧 / stats / 削除 (例: R2 バックエンド)
- bind / unbind

### common env と bindings

状態は次のように分かれています。

- space レベルの common env
- service の common env link
- worker の common env link
- service の bindings
- worker の bindings

「リソースを持つこと」と「どこへ注入するか」を分離するための構造です。

### ランタイム設定

service / worker ごとにランタイム設定・リミット・フラグを持てます。 operator
が調整する主な対象は次のとおりです。

- ホスト名 / ルート
- common env link
- リソース binding
- ランタイムフラグ / 設定 / リミット

## billing ゲート

リクエストパスごとに billing / plan ゲートをかけています。

| ゲート                             | パス                                                               |
| ---------------------------------- | ------------------------------------------------------------------ |
| ベクトル検索                       | `/api/spaces/:spaceId/search*`                                     |
| Embeddings / index                 | `/api/spaces/:spaceId/index*`                                      |
| セッション実行時間                 | `/api/sessions*`                                                   |
| Service / WFP の usage             | `/api/services*`                                                   |
| Agent ランタイム + token preflight | `/api/spaces/:spaceId/threads*`, `/api/runs*`, `/api/agent-tasks*` |

agent 系では次の制限も併用します。

- 週次のランタイムリミット
- 入力トークンの billing ゲート

## Usage / billing データモデル

Takos app は app-local の usage を記録し、課金主体は Takosumi Accounts
(`takosumi.billing.usage`) に置きます。Takos app
側の主なテーブルは次のとおりです。

- `app_usage_events`
- `app_usage_rollups`

billing の所有者は Takosumi Accounts の `takosumi.billing.usage` BillingPort
です。 Takos app は usage イベントを記録し、billing API は Accounts
側が提供します。

## operator が確認すべき状態

- リソースインベントリ
- access grant / binding material の credential
- common env のドリフト
- service / worker のランタイム設定
- usage rollup
- billing ステータス

公開 API パスの詳細は [API リファレンス](/reference/api) を、billing の詳細は
[Billing](/platform/billing) を参照してください。
