# 課金

**Billed by the operator account plane / BillingPort.**

Takos の課金主体は **その instance の operator account plane / BillingPort**
であり、managed example では Takosumi Cloud がその operator distribution
です。Takos plan (Free / Plus / Pay As You Go) は operator invoice の中の line
item の 1 つとして扱われます。契約 / billing owner / payment method は
[Takosumi Account](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
に紐づきます。Takos 自体は billing owner ではなく、Takos product usage を
operator BillingPort に報告します。 bundled / third-party apps の usage は
AppInstallation id に紐づく line item として扱われます。 Takos product 自身も
AppInstallation ledger に登録されます (distribution boundary を表すため source
は `takos-product://managed/takos`)が、 record 構造 / lifecycle は通常の
installation と同等であり、 architecture 上の特権 layer ではありません。

ユーザーから見える表示はこうなります:

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

> 現行 API gateway split status は
> [API Gateway Split](https://github.com/tako0614/takosumi/blob/master/docs/reference/architecture/index.md#api-gateway-split)
> を参照

## プラン

| プラン            | ID          | 課金モデル         | 説明                                         |
| ----------------- | ----------- | ------------------ | -------------------------------------------- |
| **Free**          | `plan_free` | 無料               | 個人の検証・小規模利用向け。デフォルトプラン |
| **Plus**          | `plan_plus` | サブスクリプション | 個人向け有料プラン。Stripe Checkout で契約   |
| **Pay As You Go** | `plan_payg` | プリペイド残高     | クレジットを購入して残高から消費             |

プランはユーザーの課金アカウント単位で 1 つ。current takosumi-cloud Accounts
(currently-deployed operator distribution example) では Takosumi Accounts の
Stripe checkout endpoint から subscription / payment checkout session を作成し、
Stripe webhook で billing state を更新します。

::: info Billing portal / invoice API Billing portal、invoice list、usage read
API は BillingPort の future expansion です。current reference Accounts HTTP
surface は `/v1/billing/stripe/checkout` と `/v1/billing/stripe/webhook`
のみを公開します。 :::

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

billing API の正本は operator account plane の `operator.billing.default`
namespace export / BillingPort です。consumer は account API が返す operator-selected
endpoint URL に対して billing request を送ります。

以下の例では resolved endpoint を `$ACCOUNTS_BILLING_ENDPOINT`
と表記します。Takos 側の `/api/billing/*` と `/api/internal/v1/billing/*` path
は current build では retired route として `410 Gone` を返し、Takosumi Accounts
billing surface への移行を示します。 invoice 主体・payment
method・subscription・usage rollup の owner は常に Takosumi Accounts です。

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

current takosumi-cloud Accounts (currently-deployed example) は top-up pack
catalog の public `GET` endpoint を公開しません。operator dashboard / install UI
が top-up SKU を見せる場合は、operator 側の catalog config から Stripe `priceId`
を選び、 `/v1/billing/stripe/checkout` に `mode: "payment"` と metadata
(`purchase_kind: "pro_topup"` など) を渡します。

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

operator account-plane billing webhook (reference impl: Takosumi Accounts) で処理される Stripe event
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

current `takosumi-cloud` Accounts reference implementation の billing HTTP
surface は次の 2 route です。

| エンドポイント                | メソッド | 説明                                        |
| ----------------------------- | -------- | ------------------------------------------- |
| `/v1/billing/stripe/checkout` | POST     | Stripe Checkout session 作成                |
| `/v1/billing/stripe/webhook`  | POST     | Stripe Webhook（認証不要・Stripe 署名検証） |

checkout body は `subject`, `priceId`, `mode`, `successUrl`, `cancelUrl`
が必須です。

Takos の `/api/billing/*` は current API ではありません。新規 client / docs /
AppInstallation flow は `operator.billing.default` / BillingPort を使います。

`/v1/billing`, `/v1/billing/usage`, `/v1/billing/portal`,
`/v1/billing/invoices*`, `/v1/billing/subscribe`,
`/v1/billing/credits/checkout`, `/v1/billing/webhook` は current takosumi-cloud
Accounts (currently-deployed example) では 公開されていません。usage
read、portal、invoice download は future BillingPort API として扱います。

## 関連ドキュメント

- [Takosumi Accounts](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/takosumi-accounts.md)
  — 契約主体 / billing owner / OIDC issuer の正本
- [Installable App Model](https://github.com/tako0614/takos-ecosystem/blob/master/docs/platform/installable-app-model.md)
  — Takos app installation と billing の関係
- [App Installation Ledger](https://github.com/tako0614/takosumi-cloud/blob/master/docs/architecture/app-installation.md)
  — installation 単位の usage / billing 紐付け
- [Upgrade と Export](/platform/upgrade-export) — plan 変更・materialize /
  export 時の billing 移行
