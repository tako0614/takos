# 課金

Takos の課金システム。使用量ベースで、プランに応じた無料枠と従量課金が適用される。

## プラン

| プラン | ID | 課金モデル | 説明 |
| --- | --- | --- | --- |
| **Free** | `plan_free` | 無料 | 個人の検証・小規模利用向け。デフォルトプラン |
| **Plus** | `plan_plus` | サブスクリプション | 個人向け有料プラン。Stripe Checkout で契約 |
| **Pay As You Go** | `plan_payg` | プリペイド残高 | クレジットを購入して残高から消費 |

プランはユーザーの課金アカウント単位で 1 つ。変更は Stripe Billing Portal または API から。

::: info レガシープラン
過去に存在した `plan_pro` と `plan_enterprise` は内部的に `plan_payg` にマッピングされます。
:::

### プランの課金モード

各プランには課金モード（`BillingMode`）が紐づいています:

| プラン | Tier | Mode |
| --- | --- | --- |
| Free | `free` | `free` |
| Plus | `plus` | `plus_subscription` |
| Pay As You Go | `pro` | `pro_prepaid` |

## プランごとのクォータ

### Free プラン

| メーター | 上限 |
| --- | --- |
| `llm_tokens_input` | 20,000 |
| `llm_tokens_output` | 10,000 |
| `embedding_count` | 200 |
| `vector_search_count` | 100 |
| `exec_seconds` | 600 |
| `browser_seconds` | 0（利用不可） |
| `web_search_count` | 20 |
| `r2_storage_gb_month` | 1 GB |
| `wfp_requests` | 100 |
| `queue_messages` | 100 |

### Plus プラン

| メーター | 上限 |
| --- | --- |
| `llm_tokens_input` | 250,000 |
| `llm_tokens_output` | 125,000 |
| `embedding_count` | 2,500 |
| `vector_search_count` | 1,250 |
| `exec_seconds` | 1,800 |
| `browser_seconds` | 120 |
| `web_search_count` | 400 |
| `r2_storage_gb_month` | 5 GB |
| `wfp_requests` | 1,000 |
| `queue_messages` | 1,000 |

### Pay As You Go プラン

全メーター上限なし（`-1` = 無制限）。代わりに使った分だけ残高から差し引かれます。

従量単価（cents/unit）:

| メーター | 単価 (cents) |
| --- | --- |
| `llm_tokens_input` | 3 |
| `llm_tokens_output` | 15 |
| `embedding_count` | 1 |
| `vector_search_count` | 2 |
| `exec_seconds` | 5 |
| `browser_seconds` | 10 |
| `web_search_count` | 5 |
| `r2_storage_gb_month` | 2,300 |
| `wfp_requests` | 1 |
| `queue_messages` | 1 |

## 使い方

### Plus にアップグレード

```bash
curl -X POST https://takos.example.com/api/billing/subscribe \
  -H "Authorization: Bearer $TOKEN"
```

レスポンス:

```json
{
  "url": "https://checkout.stripe.com/c/pay_xxx"
}
```

ブラウザでこの URL を開くと Stripe Checkout に遷移します。支払い完了後、Webhook 経由でプランが `plan_plus` に更新されます。

### PayG クレジット購入

```bash
# 利用可能なパック一覧を取得
curl https://takos.example.com/api/billing \
  -H "Authorization: Bearer $TOKEN"

# パックを指定して購入
curl -X POST https://takos.example.com/api/billing/credits/checkout \
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

Topup packs は環境変数 `STRIPE_PRO_TOPUP_PACKS_JSON` で設定されます。JSON 配列形式:

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

| フィールド | 型 | 説明 |
| --- | --- | --- |
| `id` | string | パック ID（ユニーク必須） |
| `label` | string | 表示名 |
| `price_id` | string | Stripe の Price ID |
| `credits_cents` | number | 付与されるクレジット（cents） |
| `featured` | boolean | UI でハイライト表示するか |
| `badge` | string \| null | バッジテキスト（"Popular" など） |

`GET /api/billing` のレスポンスに `topup_packs` として含まれます:

```json
{
  "plan": { "id": "plan_payg", "name": "payg", "display_name": "Pay As You Go" },
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
  "has_stripe_customer": true,
  "has_subscription": false,
  "subscription_period_end": null
}
```

::: warning Plus ユーザーは Topup 不可
Plus サブスクリプションがアクティブな状態で PayG クレジットを購入しようとすると `409 Conflict` が返ります。先にサブスクリプションをキャンセルしてから Topup してください。
:::

## ランタイム制限

全プラン共通で、エージェント実行には **7 日間ローリングウィンドウで 5 時間（18,000 秒）** の上限があります。

```typescript
WEEKLY_RUNTIME_WINDOW_DAYS = 7;
WEEKLY_RUNTIME_LIMIT_SECONDS = 5 * 60 * 60; // 18,000
```

この制限は `exec_seconds` のクォータとは別に適用されます。

## メーター

| メーター | 説明 |
| --- | --- |
| `llm_tokens_input` / `output` | AI トークン使用量 |
| `embedding_count` | エンベディング生成回数 |
| `vector_search_count` | セマンティック検索回数 |
| `exec_seconds` | セッション実行時間 |
| `browser_seconds` | ブラウザ自動化時間 |
| `web_search_count` | Web 検索回数 |
| `r2_storage_gb_month` | R2 ストレージ (GB/月) |
| `wfp_requests` | Worker リクエスト数 |
| `queue_messages` | キューメッセージ数 |

## クォータ超過時

- **80% 到達**: レスポンスヘッダーに `X-Quota-Warning: approaching`
- **上限到達**: 書き込み系 API が `402 Payment Required` で拒否
- **読み取りは継続可能**: GET / HEAD はクォータ超過時も利用できる
- **リセット**: メーターごとに日次または月次で自動リセット

## クォータリセットのタイミング

使用量ロールアップは月次で集計されます。`period_start` は毎月 1 日（UTC）です。

```text
period_start: "2026-03-01"  → 3月分の使用量
period_start: "2026-04-01"  → 4月分の使用量
```

月が変わると新しいロールアップ行が作成され、カウントは 0 からスタートします。

Plus プランのサブスクリプション更新日は `subscription_period_end` で確認できます。Stripe の `invoice.paid` Webhook で更新されます。

## プラン変更のフロー

### Free → Plus

```text
POST /api/billing/subscribe
  → Stripe Checkout に遷移
  → 支払い完了
  → Webhook: checkout.session.completed (purchase_kind: "plus_subscription")
  → planId を "plan_plus" に更新
  → stripeCustomerId / stripeSubscriptionId を保存
```

### Free → Pay As You Go

```text
POST /api/billing/credits/checkout { "pack_id": "pack_100" }
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

## API 一覧

| エンドポイント | メソッド | 説明 |
| --- | --- | --- |
| `/api/billing` | GET | 課金アカウント概要（プラン・残高・topup_packs・利用可能アクション） |
| `/api/billing/usage` | GET | 当月使用量（メーターごとの units と cost_cents） |
| `/api/billing/subscribe` | POST | Plus checkout 作成 |
| `/api/billing/credits/checkout` | POST | PayG checkout 作成（`{ "pack_id": "..." }`） |
| `/api/billing/portal` | POST | Billing Portal session |
| `/api/billing/invoices` | GET | 請求書一覧（`?limit=20&starting_after=...`） |
| `/api/billing/invoices/:id/pdf` | GET | 請求書 PDF ダウンロード |
| `/api/billing/invoices/:id/send` | POST | 請求書メール送信 |
| `/api/billing/webhook` | POST | Stripe Webhook（認証不要・Stripe 署名検証） |

### 使用量取得の例

```bash
curl https://takos.example.com/api/billing/usage \
  -H "Authorization: Bearer $TOKEN"
```

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
curl -X POST https://takos.example.com/api/billing/portal \
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
curl "https://takos.example.com/api/billing/invoices?limit=10" \
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
