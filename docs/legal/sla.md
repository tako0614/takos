# Legal: Service Level Agreement

> このページでわかること: Takos / Takosumi リファレンスディストリビューションの
> サービス可用性目標、計測方法、除外事由、クレジットポリシー、請求手順。

**Template — operator review required before public launch.** Availability
targets, credit percentages, and claim procedures must be reviewed with legal
and operations owners before publishing.

## Status

| Field         | Value                                                                            |
| ------------- | -------------------------------------------------------------------------------- |
| Owner         | Operator operations owner                                                        |
| Last reviewed | `[EFFECTIVE_DATE]`                                                               |
| Scope         | Takos Web / API, Git service profile, agent runtime profile (shared / dedicated) |
| Status        | Template — pre-public-launch baseline                                            |

## 1. サービス可用性目標 (Service Availability Target)

| プラン                          | 月次可用性目標 | 計測対象                                        |
| ------------------------------- | -------------- | ----------------------------------------------- |
| Shared-cell (default)           | `[99.5%]`      | Takos Web / API endpoints, dashboard access     |
| Dedicated (enterprise)          | `[99.9%]`      | Customer-isolated workload, dedicated endpoints |
| Git service profile (shared)    | `[99.5%]`      | Git Smart HTTP push / fetch                     |
| Git service profile (dedicated) | `[99.9%]`      | Git Smart HTTP push / fetch (dedicated)         |
| Agent runtime profile           | `[99.0%]`      | Agent run start latency < `[60s]`               |

可用性は **暦月単位** で計測します。計測対象の endpoint は
[Status Page](/legal/status-page) で公開されます。

## 2. 計測方法

- **Uptime check**: `[1 分]` ごとに external synthetic monitoring (`[MONITORING_VENDOR]`)
  から各 endpoint に HTTP request を送信し、HTTP 2xx / 3xx 応答かつ応答時間
  `[5s]` 以内を「up」と判定。
- **Aggregation**: 月内の `up` 計測回数 / 全計測回数 × 100% を可用性として算出。
- **公開**: 計測結果は [Status Page](/legal/status-page) で月次に公開し、過去 12
  ヶ月分の履歴を維持。

## 3. 除外事由

以下の時間帯は可用性計算から除外されます:

- **計画メンテナンス**: 当社が施行 48 時間前までに通知した計画メンテナンス
  (月次 `[2 時間]` 以内、UTC `[18:00-22:00]` の low-traffic window 内で実施)
- **緊急セキュリティパッチ**: zero-day 脆弱性対応など、事前通知が現実的でない緊急メンテナンス
  (事後 24 時間以内に Status Page で報告)
- **不可抗力**: 自然災害、戦争、政府命令、大規模インターネット障害、上流クラウド事業者の
  region-wide outage
- **顧客起因の障害**: 顧客の構成ミス、customer Source バグ、quota 超過、不正利用に起因する障害
- **DDoS / 攻撃対応**: 大規模 DDoS 攻撃中の防御措置による一時的アクセス制限
- **第三者依存**: 顧客が選択した外部 OIDC IdP / AI provider / 外部 webhook 等の障害

## 4. クレジットポリシー

月次可用性目標を下回った場合、顧客は以下のサービスクレジットを請求できます:

### 4.1 Shared-cell プラン (目標 99.5%)

| 月次可用性    | クレジット (当該月の月額料金に対する %) |
| ------------- | --------------------------------------- |
| 99.0% — 99.5% | 5%                                      |
| 95.0% — 99.0% | 10%                                     |
| < 95.0%       | 25%                                     |

### 4.2 Dedicated プラン (目標 99.9%)

| 月次可用性    | クレジット (当該月の月額料金に対する %) |
| ------------- | --------------------------------------- |
| 99.5% — 99.9% | 5%                                      |
| 99.0% — 99.5% | 10%                                     |
| 95.0% — 99.0% | 25%                                     |
| < 95.0%       | 50%                                     |

### 4.3 上限

単一顧客に対する単月のクレジット総額は、当該顧客が当該月に当社に支払った合計金額の
**30% を上限** とします。

## 5. 請求手順

サービスクレジットの請求は以下の手順で行います:

1. **発見**: 顧客は可用性違反を発見してから **30 日以内** に請求を提出する必要があります。
2. **提出**: `[SLA_CLAIM_EMAIL]` に以下を記載したメールを送付:
   - 顧客 Takosumi Account ID
   - 影響を受けた Capsule ID と期間 (UTC 時刻)
   - 観察した症状と再現手順
3. **検証**: 当社は受領後 **14 営業日以内** に Status Page および内部監視データと
   突合し、可否を判定して通知します。
4. **適用**: 承認されたクレジットは次回請求書に反映されます。返金 (cash refund)
   は行いません。

## 6. 排他的救済 (Sole Remedy)

サービスクレジットは、可用性違反に対する **顧客の唯一かつ排他的な救済手段** です。
[Terms of Service](/legal/terms-of-service) §7 の責任制限が適用されます。

## 7. 連絡先

| 用途             | 連絡先                                   |
| ---------------- | ---------------------------------------- |
| SLA クレーム提出 | `[SLA_CLAIM_EMAIL]`                      |
| 一般問合せ       | `[OPERATOR_EMAIL]`                       |
| 障害報告         | [Status Page](/legal/status-page) を参照 |

施行日: `[EFFECTIVE_DATE]`
