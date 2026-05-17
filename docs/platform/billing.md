# 課金

> このページでわかること: Takos の課金の仕組みとユーザーから見える表示。

Takos の課金はオペレーターの account plane (BillingPort) が担当します。 Takos
プラン (Free / Plus / Pay As You Go)
はオペレーターの請求書に含まれる形で課金されます。

- 契約・支払い方法は
  [Takosumi Account](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  に紐づく
- Takos 自体は課金主体ではなく、利用量をオペレーターの BillingPort
  に報告する立場
- アプリの利用量は Installation 単位で計上

::: warning Public paid access
このページの Plus / Pay As You Go と Stripe Checkout は operator account plane の current contract
を説明するものです。`takosumi-cloud` reference implementation の public paid checkout は、managed offering
launch-readiness evidence、`acceptedReady: true` topology reports、`ready: true` public summary、saved live audit、
canonical digest、separate operator approval、sanitized public summary が揃い、`managed-offering:status` が
`canOpenManagedOffering: true` を返すまで closed です。
:::

ユーザーから見える表示:

```txt
Takos Plus
¥3,000 / month
Billed by <operator>
```

つまり:

| 見た目             | 実体                                         |
| ------------------ | -------------------------------------------- |
| Product name       | Takos Plus                                   |
| Contract owner     | operator account plane / BillingPort         |
| Product usage      | Takos plan / Takos product usage             |
| Invoice issuer     | operator (managed example は Takosumi Cloud) |
| Billing line items | Takos plan + compute / storage / model usage |

## プラン

| プラン            | ID          | 課金モデル         | 説明                                         |
| ----------------- | ----------- | ------------------ | -------------------------------------------- |
| **Free**          | `plan_free` | 無料               | 個人の検証・小規模利用向け。デフォルトプラン |
| **Plus**          | `plan_plus` | サブスクリプション | operator が public paid access を開いた後に Stripe Checkout で契約 |
| **Pay As You Go** | `plan_payg` | プリペイド残高     | operator が paid checkout を開いた後にクレジットを購入して残高から消費 |

プランは課金アカウントごとに 1 つです。takosumi-cloud Accounts では、operator が managed offering gate
を開いた場合に Takosumi Accounts の Stripe checkout endpoint からサブスクリプション / 支払い checkout session
を作成し、Stripe webhook で billing 状態を更新します。

::: info Billing portal / invoice API Billing portal、invoice list、usage read
API は将来の拡張予定です。 現在の Accounts HTTP surface は
`/v1/billing/stripe/checkout` と `/v1/billing/stripe/webhook` のみを公開します。
:::

## Billing line item の構造

operator invoice は以下の line item から構成されます:

```ts
type BillingLineItem = {
  accountId: string;
  installationId?: string; // bundled / third-party app usage の場合だけ入る
  product: "takos";
  kind:
    | "subscription"
    | "compute_usage"
    | "storage_usage"
    | "model_usage";

  amount: number;
  currency: "JPY" | "USD";
};
```

`product: "takos"` の line item が Takos product plan / usage を表します。
bundled / third-party app usage は `installationId` と app id を別 metadata
に持つ line item として並列に積み上がります。

### プランの課金モード

各プランには課金モード（`BillingMode`）が紐づいています:

| プラン        | Tier   | Mode                |
| ------------- | ------ | ------------------- |
| Free          | `free` | `free`              |
| Plus          | `plus` | `plus_subscription` |
| Pay As You Go | `pro`  | `pro_prepaid`       |

## プランごとのクォータ

### Free プラン

| メーター              | 上限   |
| --------------------- | ------ |
| `llm_tokens_input`    | 20,000 |
| `llm_tokens_output`   | 10,000 |
| `embedding_count`     | 200    |
| `vector_search_count` | 100    |
| `exec_seconds`        | 600    |
| `web_search_count`    | 20     |
| `r2_storage_gb_month` | 1 GB   |
| `wfp_requests`        | 100    |
| `queue_messages`      | 100    |

### Plus プラン

| メーター              | 上限    |
| --------------------- | ------- |
| `llm_tokens_input`    | 250,000 |
| `llm_tokens_output`   | 125,000 |
| `embedding_count`     | 2,500   |
| `vector_search_count` | 1,250   |
| `exec_seconds`        | 1,800   |
| `web_search_count`    | 400     |
| `r2_storage_gb_month` | 5 GB    |
| `wfp_requests`        | 1,000   |
| `queue_messages`      | 1,000   |

### Pay As You Go プラン

全メーター上限なし（`-1` =
無制限）。代わりに使った分だけ残高から差し引かれます。

従量単価（cents/unit）:

| メーター              | 単価 (cents) |
| --------------------- | ------------ |
| `llm_tokens_input`    | 3            |
| `llm_tokens_output`   | 15           |
| `embedding_count`     | 1            |
| `vector_search_count` | 2            |
| `exec_seconds`        | 5            |
| `web_search_count`    | 5            |
| `r2_storage_gb_month` | 2,300        |
| `wfp_requests`        | 1            |
| `queue_messages`      | 1            |

## 使い方

### API の所在

請求 API はオペレーターの account plane が提供します。consumer は account API
で返される endpoint URL に対して billing request を送ります。

以下の例では解決済みの endpoint を `$ACCOUNTS_BILLING_ENDPOINT` と表記します。
invoice・支払い方法・サブスクリプション・使用量集計はすべて Takosumi Accounts
が所有します。

### Plus にアップグレード

```bash
curl -X POST "$ACCOUNTS_BILLING_ENDPOINT/v1/billing/stripe/checkout" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "tsub_account",
    "priceId": "price_plus_monthly",
    "mode": "subscription",
    "successUrl": "https://accounts.example.test/billing/success",
    "cancelUrl": "https://accounts.example.test/billing/cancel",
    "metadata": { "purchase_kind": "plus_subscription" }
  }'
```

レスポンス:

```json
{
  "session_id": "cs_xxx",
  "url": "https://checkout.stripe.com/c/pay_xxx"
}
```

ブラウザでこの URL を開くと Stripe Checkout に遷移します。支払い完了後、Webhook
経由でプランが `plan_plus` に更新されます。

### PayG クレジット購入

```bash
curl -X POST "$ACCOUNTS_BILLING_ENDPOINT/v1/billing/stripe/checkout" \
  -H "Content-Type: application/json" \
  -d '{
    "subject": "tsub_account",
    "priceId": "price_payg_topup",
    "mode": "payment",
    "successUrl": "https://accounts.example.test/billing/success",
    "cancelUrl": "https://accounts.example.test/billing/cancel",
    "metadata": { "purchase_kind": "pro_topup" }
  }'
```

レスポンス:

```json
{
  "session_id": "cs_xxx",
  "url": "https://checkout.stripe.com/c/pay_xxx"
}
```

## Topup Packs

takosumi-cloud Accounts は top-up pack catalog の public `GET` endpoint を
公開していません。オペレーターの dashboard / install UI で top-up SKU を表示
する場合は、operator 側の catalog config から Stripe の `priceId` を選び、
`/v1/billing/stripe/checkout` に `mode: "payment"` と metadata (例:
`purchase_kind: "pro_topup"`) を渡してください。

::: warning Plus ユーザーは Topup 不可 Plus
サブスクリプションがアクティブな状態で PayG クレジットを購入しようとすると
`409 Conflict` が返ります。先にサブスクリプションをキャンセルしてから Topup
してください。 :::

## ランタイム制限

全プラン共通で、エージェント実行には **7 日間ローリングウィンドウで 5
時間（18,000 秒）** の上限があります。

```typescript
WEEKLY_RUNTIME_WINDOW_DAYS = 7;
WEEKLY_RUNTIME_LIMIT_SECONDS = 5 * 60 * 60; // 18,000
```

この制限は `exec_seconds` のクォータとは別に適用されます。

## メーター

| メーター                      | 説明                   |
| ----------------------------- | ---------------------- |
| `llm_tokens_input` / `output` | AI トークン使用量      |
| `embedding_count`             | エンベディング生成回数 |
| `vector_search_count`         | セマンティック検索回数 |
| `exec_seconds`                | セッション実行時間     |
| `web_search_count`            | Web 検索回数           |
| `r2_storage_gb_month`         | R2 ストレージ (GB/月)  |
| `wfp_requests`                | Worker リクエスト数    |
| `queue_messages`              | キューメッセージ数     |

## クォータ超過時

- **80% 到達**: 月次上限があるメーターで、書き込み系 API の推定使用量を足した
  projected usage が上限の 80% 以上になる場合、レスポンスヘッダーに
  `X-Quota-Warning: approaching`
- **上限到達**: 書き込み系 API が `402 Payment Required` で拒否
- **読み取りは継続可能**: GET / HEAD はクォータ超過時も利用できる
- **リセット**: 全メーター月次で自動リセット (詳細は下記)

## クォータリセットのタイミング

**全メーターは月次でリセットされます。** メーターごとの個別 reset cycle
はありません。

使用量ロールアップは `period_start` を基準にした月次集計で、`period_start`
は毎月 1 日 00:00 (UTC) です。

```text
period_start: "2026-03-01"  → 3月分 (2026-03-01 00:00 UTC ～ 2026-04-01 00:00 UTC)
period_start: "2026-04-01"  → 4月分 (2026-04-01 00:00 UTC ～ 2026-05-01 00:00 UTC)
```

毎月 1 日 (UTC) に新しいロールアップ行が作成され、すべてのメーター
(`llm_tokens_input` / `llm_tokens_output` / `embedding_count` /
`vector_search_count` / `exec_seconds` / `web_search_count` / `wfp_requests` /
`queue_messages`) のカウントが 0 からスタートします。

::: info `r2_storage_gb_month` の扱い `r2_storage_gb_month`
だけはストレージ滞在量に対する平均値メーターであり、毎月の集計でリセットされる
counter
ではなく、その月のストレージ占有量から算出されます。それ以外のメーターはすべて 0
リセットの monthly counter です。 :::

::: info ランタイム制限は別枠 `exec_seconds`
の月次クォータとは別に、[ランタイム制限](#ランタイム制限) として 7
日ローリングウィンドウ 18,000
秒の独立した上限が適用されます。これは月次リセットとは別のスライディングウィンドウで管理されます。
:::

Plus プランのサブスクリプション更新日は `subscription_period_end`
で確認できます。Stripe の `invoice.paid` Webhook
で更新されます。サブスクリプション更新日と meter reset 日は異なる場合があります
(meter reset は常に UTC の月初)。

## プラン変更のフロー

### Free → Plus

```text
POST /v1/billing/stripe/checkout { "mode": "subscription", "priceId": "price_plus_monthly" }
  → Stripe Checkout に遷移
  → 支払い完了
  → Webhook: checkout.session.completed (purchase_kind: "plus_subscription")
  → planId を "plan_plus" に更新
  → processorCustomerId / processorSubscriptionId を保存
```

### Free → Pay As You Go

```text
POST /v1/billing/stripe/checkout { "mode": "payment", "priceId": "price_payg_topup" }
  → Stripe Checkout に遷移
  → 支払い完了
  → Webhook: checkout.session.completed (purchase_kind: "pro_topup")
  → planId を "plan_payg" に更新
  → クレジットを残高に加算
```

### Plus → 解約

```text
Stripe dashboard / operator billing UI でサブスクリプションをキャンセル
  → Webhook: customer.subscription.deleted
  → 残高があれば "plan_payg" に、なければ "plan_free" にダウングレード
```

## Handled webhook events

operator account-plane billing webhook (reference impl: Takosumi Accounts)
で処理される Stripe event の一覧です。列挙された event 以外は signature 検証後に
`200 OK` で ack しますが、state 更新は行いません。

| event                           | 用途                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `checkout.session.completed`    | Pro top-up クレジット付与 / Plus subscription start           |
| `invoice.paid`                  | Plus subscription period end の同期                           |
| `invoice.payment_failed`        | `status='past_due'` に flip (dunning UI)                      |
| `customer.subscription.updated` | plan change / cancel-at-period-end / status の同期            |
| `customer.subscription.deleted` | terminal cancel → `plan_payg` or `plan_free` にダウングレード |

## API 一覧

current `takosumi-cloud` Accounts reference implementation の billing HTTP
surface は、Stripe checkout / webhook と Installation scoped usage report
ingest です。

| エンドポイント                                      | メソッド | 説明                                                                                         |
| --------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `/v1/billing/stripe/checkout`                       | POST     | Stripe Checkout session 作成                                                                 |
| `/v1/billing/stripe/webhook`                        | POST     | Stripe Webhook（認証不要・Stripe 署名検証）                                                  |
| `/v1/installations/{id}/billing/usage-reports`      | POST     | Installation OIDC access token + `billing.usage.report` permission grant で保護された使用量 report |

checkout body は `subject`, `priceId`, `mode`, `successUrl`, `cancelUrl`
が必須です。

請求は Takosumi Accounts の BillingPort を使います。使用量の ingest と entitlement
projection は Accounts reference implementation にあり、customer portal / invoice
download の公開 UI は managed offering launch overlay の運用 hardening として扱います。

## 関連ドキュメント

- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  — 契約主体 / billing owner / OIDC issuer の詳細
- [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  — Takos app installation と billing の関係
- [App Installation Ledger](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
  — installation 単位の usage / billing 紐付け
- [Upgrade と Export](/platform/upgrade-export) — plan 変更・materialize /
  export 時の billing 再紐付け
