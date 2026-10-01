# リソースガバナンス

> このページでわかること: Takos のリソース管理・アクセス制御・課金連携の仕組み。

リソースガバナンスは、リソースの
CRUD、アクセス制御、ランタイム設定、usage 計測の組み合わせで構成されています。

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

リソース操作の基点となる公開 API はまだありません。設計上の責務は次のとおりです。

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

## billing とレート制限

Takos app の router には billing / plan ゲートを載せていません。商用の
billing ポリシーは Takosumi Accounts / Cloud 側が適用します。Takos app
側が持つのは次の 2 つです。

- usage の計測: `app_usage_events` に記録し、`app_usage_rollups` に
  集約します (agent の入力トークン数を含む)
- リクエストのレート制限: sliding window / token bucket の
  Durable Object (`RateLimiterDO`)

## Usage / billing データモデル

Takos app は app-local の usage を記録し、課金主体は Takosumi Accounts
(`takosumi.billing.usage`) に置きます。Takos app
側の主なテーブルは次のとおりです。

- `app_usage_events`
- `app_usage_rollups`

新しい usage の event と期間集計は同じ SQL transaction / native batch で
保存します。同じ冪等キーの再送は集計を増やしません。Run の記録では全メーターを
まとめて保存し、読取・展開・SQL の失敗を成功として扱いません。内部 run-usage
応答の `recorded: false` は、記録を再試行する必要があることを示します。

RunNotifier は受理した canonical 8 メーターの累積合計と revision を、pending と再送
receipt と同じ commit head に保存します。Run 終了は usage の封印ではなく、終了後の
追加 usage も同じ経路で反映します。SQL の応答が失われたり反映に失敗した場合は、
dirty revision を残して alarm で再試行します。古い応答は新しい revision を解除しません。
通常の反映に R2 の全件読取や 50,000件の切捨てはありません。

固定 Run／meter 行は累積合計の投影です。再試行は値を下げず、最初の行 ID・所有者・
scope・記録月を保ちます。その月の rollup は同じ transaction 内で canonical event 行
から再計算するため、過去の部分集計も修復できます。行や履歴を削除しません。
既存キーの所有者・scope・Run・メーターや月が矛盾する場合は全メーターを拒否します。
Run の Workspace ID は space scope に保持し、owner は Workspace の ownerAccountId
から解決します。旧行の Workspace-as-owner が現在の所有者と矛盾するときは、自動で
所有者を書き換えず修復対象として拒否します。

単位は従来どおり JavaScript／SQL REAL の浮動小数点です。正の増分が既存合計に完全に
吸収される場合や overflow は拒否します。edge.sql の数値パラメーター制限を超える
有限値は、検証済み数値だけを SQL literal にして反映します。任意文字列を literal に
しません。厳密な十進課金や通貨計算の契約を新設したものではありません。

旧 notifier の合計を作る際は保存済み frontier と object inventory、厳密な gzip、pending
を照合します。segment 0、欠落、由来不明の object や壊れた body を空の履歴として
扱いません。修復が必要な履歴は保持して集計を拒否します。未知の有効 meter token は
archive に残し、既存方針どおり canonical usage へ算入しません。
SQL token と raw token meter の加算方針は従来どおりで、producer の重複・再送 identity
と実 backend の atomicity／alarm 配送は別の GA 検証条件です。

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
