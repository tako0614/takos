# 課金アーキテクチャ

Takos の課金システムの設計と仕組みをまとめます。

## 概要

Takos は使用量ベースの課金モデルを採用しています。課金アカウントはユーザー (Account) 単位で紐づき、プランに応じた無料枠と従量課金が適用されます。使用量はメーターで計測され、クォータを超過すると書き込み系の API が制限されます。

## プラン

課金アカウントに紐づくプランは次の 3 種類です。

| プラン ID | 表示名 | 課金モデル | 説明 |
| --- | --- | --- | --- |
| `plan_free` | Free | 無料 | 無料枠。個人の検証・小規模利用向け |
| `plan_plus` | Plus | サブスクリプション | 個人向け有料プラン。Stripe Checkout で契約 |
| `plan_payg` | Pay As You Go | プリペイド残高 | 従量課金プラン。クレジットを購入して残高から消費 |

プランはユーザーの課金アカウント (`billingAccounts.accountId`) 単位で 1 つ保持します。プランの変更は Stripe Billing Portal 経由、または API から行えます。

## メータータイプ

使用量の計測はメーター単位で行います。各メーターは独立にカウントされ、プランごとに無料枠と上限が設定されます。

| メーター | 説明 |
| --- | --- |
| `llm_tokens_input` | AI エージェントのトークン使用量 (入力) |
| `llm_tokens_output` | AI エージェントのトークン使用量 (出力) |
| `embedding_count` | エンベディング生成の回数 |
| `vector_search_count` | セマンティック検索のリクエスト回数 |
| `exec_seconds` | セッション実行時間 (秒単位) |
| `browser_seconds` | ブラウザ自動化の実行時間 (秒単位) |
| `web_search_count` | Web 検索のリクエスト回数 |
| `r2_storage_gb_month` | R2 ストレージ使用量 (GB/月) |
| `wfp_requests` | Worker リクエスト数 |
| `queue_messages` | キューメッセージ数 |

メーターの値は Analytics Engine に書き込まれ、定期的に集計されます。集計結果は Control Plane の DB に保存され、課金ゲートの判定に使われます。

## 課金ゲートミドルウェア

API リクエストに対する課金チェックは、ミドルウェアとして Control Plane に組み込まれています。

### 判定ルール

- **GET / HEAD** — 常に無料。課金チェックをスキップする
- **POST / PATCH / DELETE** — 課金チェックを実行する。プランのクォータ内であれば通過、超過していれば拒否

### レスポンス

クォータ超過時は `402 Payment Required` を返します。

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "error": "quota_exceeded",
  "meter": "exec_seconds",
  "plan": "plan_free",
  "message": "プランの上限に達しました。プランをアップグレードしてください。"
}
```

クライアントはこのレスポンスを受けてユーザーにアップグレードを促す UI を表示できます。

## Stripe 連携

課金の決済と管理には Stripe を使用しています。

### Plus サブスクリプション

Plus プランへのアップグレードは Stripe Checkout Session を作成し、ユーザーを Stripe のホスト型決済ページへリダイレクトします。

```
POST /api/billing/subscribe
→ { "url": "https://checkout.stripe.com/c/pay_xxx" }
```

リクエストボディは不要です。認証済みユーザーの課金アカウントに対して checkout を作成します。

### Pay As You Go クレジット購入

PayG プランではクレジットパックを購入して残高をチャージします。

```
POST /api/billing/credits/checkout
{ "pack_id": "pack_xxx" }
→ { "url": "https://checkout.stripe.com/c/pay_xxx" }
```

利用可能なパックは `GET /api/billing` の `topup_packs` で取得できます。

### Webhook

Stripe からのイベントは `/api/billing/webhook` エンドポイントで受信します。処理するイベントは次のとおりです。

| イベント | 処理 |
| --- | --- |
| `checkout.session.completed` | Plus のアクティベーション、または PayG クレジットの加算 |
| `invoice.paid` | サブスクリプション期間の更新 |
| `customer.subscription.deleted` | プランの解約処理 (残高があれば PayG へ、なければ Free へダウングレード) |

Webhook の署名検証は HMAC-SHA256 で行い、不正なリクエストは拒否します。

### Billing Portal

既存ユーザーのプラン管理 (プラン変更、カード情報更新、請求書確認) は Stripe Billing Portal を利用します。

```
POST /api/billing/portal
→ { "url": "https://billing.stripe.com/p/session/xxx" }
```

リクエストボディは不要です。認証済みユーザーの Stripe Customer ID から portal session を作成します。

## API エンドポイント一覧

| エンドポイント | メソッド | 説明 |
| --- | --- | --- |
| `/api/billing` | GET | 課金アカウント概要 (プラン、残高、利用可能アクション、パック一覧) |
| `/api/billing/usage` | GET | 当月使用量 (メーター別の units と cost_cents) |
| `/api/billing/subscribe` | POST | Plus サブスクリプション checkout 作成 |
| `/api/billing/credits/checkout` | POST | PayG クレジットパック checkout 作成 |
| `/api/billing/portal` | POST | Stripe Billing Portal session 作成 |
| `/api/billing/invoices` | GET | 請求書一覧 |
| `/api/billing/invoices/:id/pdf` | GET | 請求書 PDF ダウンロード |
| `/api/billing/invoices/:id/send` | POST | 請求書メール送信 |
| `/api/billing/webhook` | POST | Stripe Webhook 受信 |

## クォータ超過時の動作

クォータ超過が検出された場合、システムは段階的に制限を適用します。

1. **ソフトリミット到達** — 使用量がプラン上限の 80% に達すると、API レスポンスヘッダーに警告を付与する (`X-Quota-Warning: approaching`)
2. **ハードリミット到達** — 使用量がプラン上限に達すると、書き込み系 API が `402 Payment Required` で拒否される
3. **読み取りは継続可能** — GET / HEAD リクエストはクォータ超過時も引き続き利用できる
4. **解約時のフォールバック** — サブスクリプション解約時、残高があれば PayG に、なければ Free にダウングレードする

クォータはリセット周期 (日次または月次) で自動リセットされます。リセットタイミングはメーターごとに定義されます。
