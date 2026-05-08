# 課金

**Billed by Takosumi Cloud.**

Takos の課金主体は **Takosumi Cloud** であり、Takos plan (Free / Plus / Pay As
You Go) は Takosumi Cloud invoice の中の line item の 1 つとして扱われます。契約
/ billing owner / payment method は
[Takosumi Account](/architecture/takosumi-accounts) に紐づきます。Takos 自体は
billing owner ではなく、Takosumi Account に install された app として使用量を
Takosumi Cloud に報告します。

ユーザーから見える表示はこうなります:

```txt
Takos Plus
¥3,000 / month
Billed by Takosumi Cloud
```

つまり:

| 見た目             | 実体                                         |
| ------------------ | -------------------------------------------- |
| Product name       | Takos Plus                                   |
| Contract owner     | Takosumi Cloud (Takosumi Account 主体)       |
| Installed app      | takos.chat                                   |
| Invoice issuer     | Takosumi Cloud                               |
| Billing line items | Takos plan + compute / storage / model usage |

> 現行 API gateway split status は
> [API Gateway Split](/takosumi/current-state#api-gateway-split) を参照

## プラン

| プラン            | ID          | 課金モデル         | 説明                                         |
| ----------------- | ----------- | ------------------ | -------------------------------------------- |
| **Free**          | `plan_free` | 無料               | 個人の検証・小規模利用向け。デフォルトプラン |
| **Plus**          | `plan_plus` | サブスクリプション | 個人向け有料プラン。Stripe Checkout で契約   |
| **Pay As You Go** | `plan_payg` | プリペイド残高     | クレジットを購入して残高から消費             |

プランはユーザーの課金アカウント単位で 1 つ。変更は Takosumi Accounts billing
API または billing portal から行います。

::: info Stripe Billing Portal は temporary 現在の Stripe Billing Portal は
temporary measure として維持されており、最終的には
[Takosumi Accounts](/architecture/takosumi-accounts) の billing portal
に統合される予定です。invoice 主体・payment method 管理・subscription
状態はすべて Takosumi Cloud 配下に集約されます。 :::

## Billing line item の構造

Takosumi Cloud invoice は以下の line item から構成されます:

```ts
type BillingLineItem = {
  accountId: string;
  installationId?: string;
  product: "takos.chat";
  kind:
    | "subscription"
    | "compute_usage"
    | "storage_usage"
    | "model_usage";

  amount: number;
  currency: "JPY" | "USD";
};
```

`product: "takos.chat"` の line item が 1 つの Takos installation
の使用量を表し、`subscription` (Plus / PayG plan) と `compute_usage` /
`storage_usage` / `model_usage` は同じ Takosumi Account に対する separate line
items として並列に積み上がります。

::: info レガシープラン 過去に存在した `plan_pro` と `plan_enterprise`
は内部的に `plan_payg` にマッピングされます。 :::

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

### API ownership

billing API の正本は Takosumi Accounts の `takosumi.account.billing@v1` service
role です。consumer は `serviceResolvers[]` / anchor で endpoint を resolve
し、operator-injected endpoint URL に対して billing request を送ります。

以下の例では resolved endpoint を `$ACCOUNTS_BILLING_ENDPOINT`
と表記します。migration window 中に Takos 側の `/api/billing/*` path
が残る場合も、それは Takos product compatibility proxy であり、invoice 主体・
payment method・subscription・usage rollup の owner ではありません。

### Plus にアップグレード

```bash
curl -X POST "$ACCOUNTS_BILLING_ENDPOINT/v1/billing/subscribe" \
  -H "Authorization: Bearer $TOKEN"
```

レスポンス:

```json
{
  "url": "https://checkout.stripe.com/c/pay_xxx"
}
```

ブラウザでこの URL を開くと Stripe Checkout に遷移します。支払い完了後、Webhook
経由でプランが `plan_plus` に更新されます。

### PayG クレジット購入

```bash
# 利用可能なパック一覧を取得
curl "$ACCOUNTS_BILLING_ENDPOINT/v1/billing" \
  -H "Authorization: Bearer $TOKEN"

# パックを指定して購入
curl -X POST "$ACCOUNTS_BILLING_ENDPOINT/v1/billing/credits/checkout" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pack_id": "pack_xxx"}'
```

レスポンス:

```json
{
  "url": "https://checkout.stripe.com/c/pay_xxx"
}
```

## Topup Packs

Topup packs は環境変数 `STRIPE_PRO_TOPUP_PACKS_JSON` で設定されます。JSON
配列形式:

```json
[
  {
    "id": "pack_100",
    "label": "100 credits",
    "price_id": "price_xxx",
    "credits_cents": 10000,
    "featured": true,
    "badge": "Popular"
  },
  {
    "id": "pack_500",
    "label": "500 credits",
    "price_id": "price_yyy",
    "credits_cents": 50000,
    "featured": false,
    "badge": null
  }
]
```

各フィールド:

| フィールド      | 型             | 説明                             |
| --------------- | -------------- | -------------------------------- |
| `id`            | string         | パック ID（ユニーク必須）        |
| `label`         | string         | 表示名                           |
| `price_id`      | string         | Stripe の Price ID               |
| `credits_cents` | number         | 付与されるクレジット（cents）    |
| `featured`      | boolean        | UI でハイライト表示するか        |
| `badge`         | string \| null | バッジテキスト（"Popular" など） |

`GET /v1/billing` のレスポンスに `topup_packs` として含まれます:

```json
{
  "plan": {
    "id": "plan_payg",
    "name": "payg",
    "display_name": "Pay As You Go"
  },
  "plan_tier": "pro",
  "billing_mode": "pro_prepaid",
  "balance_cents": 5000,
  "topup_packs": [
    {
      "id": "pack_100",
      "label": "100 credits",
      "price_id": "price_xxx",
      "credits_cents": 10000,
      "featured": true,
      "badge": "Popular"
    }
  ],
  "available_actions": {
    "subscribe_plus": false,
    "top_up_pro": true,
    "manage_subscription": false
  },
  "runtime_limit_7d_seconds": 18000,
  "status": "active",
  "has_payment_account": true,
  "has_stripe_customer": true,
  "has_subscription": false,
  "subscription_period_end": null
}
```

`has_payment_account` が current field です。`has_stripe_customer` は既存 Stripe
client 互換の alias で、当面は同じ boolean を返します。新規 client は payment
processor 非依存の `has_payment_account` を使ってください。

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
POST /v1/billing/subscribe
  → Stripe Checkout に遷移
  → 支払い完了
  → Webhook: checkout.session.completed (purchase_kind: "plus_subscription")
  → planId を "plan_plus" に更新
  → processorCustomerId / processorSubscriptionId を保存
```

### Free → Pay As You Go

```text
POST /v1/billing/credits/checkout { "pack_id": "pack_100" }
  → Stripe Checkout に遷移
  → 支払い完了
  → Webhook: checkout.session.completed (purchase_kind: "pro_topup")
  → planId を "plan_payg" に更新
  → クレジットを残高に加算
```

### Plus → 解約

```text
Stripe Billing Portal でサブスクリプションをキャンセル
  → Webhook: customer.subscription.deleted
  → 残高があれば "plan_payg" に、なければ "plan_free" にダウングレード
```

## Handled webhook events

Takosumi Accounts billing webhook で処理される Stripe event
の一覧です。列挙された event 以外は signature 検証後に `200 OK` で ack
しますが、state 更新は行いません。

| event                           | 用途                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `checkout.session.completed`    | Pro top-up クレジット付与 / Plus subscription start           |
| `invoice.paid`                  | Plus subscription period end の同期                           |
| `invoice.payment_failed`        | `status='past_due'` に flip (dunning UI)                      |
| `customer.subscription.updated` | plan change / cancel-at-period-end / status の同期            |
| `customer.subscription.deleted` | terminal cancel → `plan_payg` or `plan_free` にダウングレード |

## API 一覧

| エンドポイント                  | メソッド | 説明                                                                   |
| ------------------------------- | -------- | ---------------------------------------------------------------------- |
| `/v1/billing`                   | GET      | 課金アカウント概要（プラン・残高・topup_packs・利用可能アクション）    |
| `/v1/billing/usage`             | GET      | billing account 全体の当月使用量（メーターごとの units と cost_cents） |
| `/v1/billing/subscribe`         | POST     | Plus checkout 作成                                                     |
| `/v1/billing/credits/checkout`  | POST     | PayG checkout 作成（`{ "pack_id": "..." }`）                           |
| `/v1/billing/portal`            | POST     | Billing Portal session                                                 |
| `/v1/billing/invoices`          | GET      | 請求書一覧（`?limit=20&starting_after=...`）                           |
| `/v1/billing/invoices/:id/pdf`  | GET      | 請求書 PDF ダウンロード                                                |
| `/v1/billing/invoices/:id/send` | POST     | 請求書メール送信                                                       |
| `/v1/billing/webhook`           | POST     | Stripe Webhook（認証不要・Stripe 署名検証）                            |

Takos の `/api/billing/*` は、存在する場合でも上記 Accounts API への
compatibility proxy です。新規 client / docs / AppInstallation flow は
`takosumi.account.billing@v1` を resolve して使います。

### 使用量取得の例

```bash
curl "$ACCOUNTS_BILLING_ENDPOINT/v1/billing/usage" \
  -H "Authorization: Bearer $TOKEN"
```

レスポンスは `billing_account_id` 単位で集計され、space などの scoped usage も
同じ billing account のメーターとして合算されます。

レスポンス:

```json
{
  "period_start": "2026-03-01",
  "meters": [
    { "meter_type": "llm_tokens_input", "units": 15000, "cost_cents": 0 },
    { "meter_type": "exec_seconds", "units": 120, "cost_cents": 0 }
  ]
}
```

### Billing Portal の例

```bash
curl -X POST "$ACCOUNTS_BILLING_ENDPOINT/v1/billing/portal" \
  -H "Authorization: Bearer $TOKEN"
```

レスポンス:

```json
{
  "url": "https://billing.stripe.com/p/session/xxx"
}
```

### 請求書一覧の例

```bash
curl "$ACCOUNTS_BILLING_ENDPOINT/v1/billing/invoices?limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

レスポンス:

```json
{
  "invoices": [
    {
      "id": "in_xxx",
      "number": "INV-001",
      "status": "paid",
      "currency": "usd",
      "amount_due": 1000,
      "amount_paid": 1000,
      "total": 1000,
      "created": 1711584000,
      "hosted_invoice_url": "https://invoice.stripe.com/i/...",
      "invoice_pdf": "https://pay.stripe.com/invoice/..."
    }
  ],
  "has_more": false
}
```

## 関連ドキュメント

- [Takosumi Accounts](/architecture/takosumi-accounts) — 契約主体 / billing
  owner / OIDC issuer の正本
- [Installable App Model](/architecture/installable-app-model) — Takos app
  installation と billing の関係
- [App Installation Ledger](/architecture/app-installation) — installation
  単位の usage / billing 紐付け
- [Upgrade と Export](/platform/upgrade-export) — plan 変更・materialize /
  export 時の billing 移行
