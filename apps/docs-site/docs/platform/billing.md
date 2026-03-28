# 課金

Takos の課金システム。使用量ベースで、プランに応じた無料枠と従量課金が適用される。

## プラン

| プラン | 課金モデル | 説明 |
| --- | --- | --- |
| **Free** | 無料 | 個人の検証・小規模利用向け |
| **Plus** | サブスクリプション | 個人向け有料プラン。Stripe Checkout で契約 |
| **Pay As You Go** | プリペイド残高 | クレジットを購入して残高から消費 |

プランはユーザーの課金アカウント単位で 1 つ。変更は Stripe Billing Portal または API から。

## 使い方

### Plus にアップグレード

```
POST /api/billing/subscribe
→ { "url": "https://checkout.stripe.com/c/pay_xxx" }
```

### PayG クレジット購入

```
POST /api/billing/credits/checkout
{ "pack_id": "pack_xxx" }
→ { "url": "https://checkout.stripe.com/c/pay_xxx" }
```

利用可能なパックは `GET /api/billing` の `topup_packs` で取得。

### プラン管理

```
POST /api/billing/portal
→ { "url": "https://billing.stripe.com/p/session/xxx" }
```

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

## API 一覧

| エンドポイント | メソッド | 説明 |
| --- | --- | --- |
| `/api/billing` | GET | 課金アカウント概要 |
| `/api/billing/usage` | GET | 当月使用量 |
| `/api/billing/subscribe` | POST | Plus checkout 作成 |
| `/api/billing/credits/checkout` | POST | PayG checkout 作成 |
| `/api/billing/portal` | POST | Billing Portal session |
| `/api/billing/invoices` | GET | 請求書一覧 |
| `/api/billing/webhook` | POST | Stripe Webhook |
