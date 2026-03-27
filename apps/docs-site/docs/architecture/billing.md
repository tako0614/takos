# 課金アーキテクチャ

Takos の課金システムの設計と仕組みをまとめます。

## 概要

Takos は使用量ベースの課金モデルを採用しています。テナント (Space) ごとにプランが紐づき、プランに応じた無料枠と従量課金が適用されます。使用量はメーターで計測され、クォータを超過すると書き込み系の API が制限されます。

## プラン

Space に紐づく課金プランは次の 3 種類です。

| プラン | 説明 |
| --- | --- |
| free | 無料枠。個人の検証・小規模利用向け |
| pro | 個人向け有料プラン。より多くのリソースと高い上限 |
| scale | チーム向けプラン。大規模利用に対応 |

プランは Space 単位で 1 つだけ保持します。プランの変更は Stripe Billing Portal 経由、または API から行えます。

## メータータイプ

使用量の計測はメーター単位で行います。各メーターは独立にカウントされ、プランごとに無料枠と上限が設定されます。

| メーター | 説明 |
| --- | --- |
| `vector_search_count` | セマンティック検索のリクエスト回数 |
| `embedding_count` | エンベディング生成の回数 |
| `exec_seconds` | セッション実行時間 (秒単位) |
| `wfp_requests` | Worker リクエスト数 |
| `llm_tokens_input` | AI エージェントのトークン使用量 (入力) |

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
  "plan": "free",
  "message": "プランの上限に達しました。プランをアップグレードしてください。"
}
```

クライアントはこのレスポンスを受けてユーザーにアップグレードを促す UI を表示できます。

## Stripe 連携

課金の決済と管理には Stripe を使用しています。

### Checkout Session

新規プラン契約や有料プランへのアップグレード時には、Stripe Checkout Session を作成してユーザーを Stripe のホスト型決済ページへリダイレクトします。

```
POST /api/billing/checkout
{
  "spaceId": "sp_xxx",
  "plan": "pro"
}
→ { "url": "https://checkout.stripe.com/c/pay_xxx" }
```

### Webhook

Stripe からのイベントは `/api/billing/webhook` エンドポイントで受信します。主要なイベントは次のとおりです。

| イベント | 処理 |
| --- | --- |
| `checkout.session.completed` | プランのアクティベーション |
| `customer.subscription.updated` | プラン変更の反映 |
| `customer.subscription.deleted` | プランの解約処理 |
| `invoice.payment_failed` | 支払い失敗の通知・猶予期間の開始 |

Webhook の署名検証は Stripe SDK の `constructEvent` で行い、不正なリクエストは拒否します。

### Billing Portal

既存ユーザーのプラン管理 (プラン変更、カード情報更新、請求書確認) は Stripe Billing Portal を利用します。

```
POST /api/billing/portal
{
  "spaceId": "sp_xxx"
}
→ { "url": "https://billing.stripe.com/p/session/xxx" }
```

## クォータ超過時の動作

クォータ超過が検出された場合、システムは段階的に制限を適用します。

1. **ソフトリミット到達** — 使用量がプラン上限の 80% に達すると、API レスポンスヘッダーに警告を付与する (`X-Quota-Warning: approaching`)
2. **ハードリミット到達** — 使用量がプラン上限に達すると、書き込み系 API が `402 Payment Required` で拒否される
3. **読み取りは継続可能** — GET / HEAD リクエストはクォータ超過時も引き続き利用できる
4. **猶予期間** — 支払い失敗時は一定期間の猶予を設け、その間はサービスを維持する

クォータはリセット周期 (日次または月次) で自動リセットされます。リセットタイミングはメーターごとに定義されます。
