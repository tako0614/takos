# 課金

> このページでわかること: Takos の課金の仕組みと、製品の契約と operator 側の
> 実装の境界。

Takos 自体は課金主体ではありません。利用量を app-local に記録し、課金は
operator の account plane (BillingPort) が行います。

- 契約・支払い方法は operator の account plane に紐づく
- Takos は usage を記録して operator の BillingPort に報告する立場
- アプリの利用量は Capsule / installed-service projection 単位で計上

## 責務の分かれ目

| 見た目             | 実体                                 |
| ------------------ | ------------------------------------ |
| Product name       | operator が命名する plan             |
| Contract owner     | operator account plane / BillingPort |
| Product usage      | Takos plan / Takos product usage     |
| Invoice issuer     | operator                             |
| Billing line items | operator が定義する plan と usage    |

プラン名・価格・クォータの値は Takos 側の製品定数ではなく、operator が自分の
billing 実装で定義します。

## Takos 側が持つもの: usage 計測

Takos app が記録するのは usage event だけです。

- `app_usage_events`: 個別の usage event (idempotency key つき)
- `app_usage_rollups`: `period_start` 基準の期間集計

`meter_type` は open な文字列で、emit する側が stable token を決めます。
現在 Takos が emit する meter は次の 2 つです。

| メーター            | 説明                   |
| ------------------- | ---------------------- |
| `embedding_count`  | エンベディング生成回数 |
| `exec_seconds`     | セッション実行時間     |

## OSS contract が持つもの: 非 blocking の ledger と port

Takosumi の OSS contract (`contract/billing.ts`) は billing を
operator-scoped で non-blocking な ledger として定義します。plan、
subscription、balance、invoice などの commercial record は host 側の
所有物で、OSS contract を越えません。

commercial な強制は port として差し込みます。

- `BillingEnforcement`: plan 時に reserve / capture / release を差し込む
  port。通るはずの plan を block することだけができます
- `QuotaPolicy`: plan quota / per-run limit の port。OSS の既定は
  `NOOP_QUOTA_POLICY` (制限なし)

つまり OSS 単体では、quota 超過で API が拒否されることはありません。商用の
強制は host (managed example: Takosumi Cloud) が自分の billing module から
注入します。

## reference implementation の HTTP surface

公開 billing API は operator の account plane が提供します。reference
implementation 側に実在する surface は次のとおりです。

- Takosumi Accounts: `GET /api/v1/workspaces/{workspaceId}/billing`
  (workspace の billing 状態の read)
- Takosumi hosted (closed): wallet 残高への checkout
  (`/v1/marketplace/wallet/checkout` 系) と subscription 系
  (`/api/v1/account/subscription/*`)。wallet の reserve / capture と
  `insufficient_quota` (402) は hosted の billing module が実装します

Billing portal、invoice list、usage read API は今のところ公開 surface に
ありません。

## operator が確認すべき状態

- usage event / rollup の蓄積
- operator account plane 側の billing ステータス

## 関連ドキュメント

- [Takosumi を自分で動かす](https://takosumi.com/docs/concepts/self-host)
  —契約主体 / billing owner / OIDC issuer の詳細
- [Takosumi Capsule Lifecycle](https://takosumi.com/docs/concepts/)
  — Takos app installation と billing の関係
- [Upgrade と Export](/platform/upgrade-export) — plan 変更・反映 /
  export 時の billing 再紐付け
