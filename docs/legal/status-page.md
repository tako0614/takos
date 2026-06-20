# Legal: Status Page

> このページでわかること: Takos / Takosumi リファレンスディストリビューションの
> 公開ステータスページ URL、障害分類、購読方法、障害報告連絡先。

**Template — operator review required before public launch.** 公開 status page
URL と購読基盤を確定してから公開してください。

## Status

| Field         | Value                                                                  |
| ------------- | ---------------------------------------------------------------------- |
| Owner         | Operator operations owner                                              |
| Last reviewed | `[EFFECTIVE_DATE]`                                                     |
| Scope         | Takos Web / API, Git service profile, agent runtime profile, dashboard |
| Status        | Template — pre-public-launch baseline                                  |

## 1. 公開ステータスページ

リアルタイムなサービス状態は以下で公開しています:

- **URL**: `https://status.takosumi.com` (`[STATUS_PAGE_URL]` をオペレーターが設定)
- **更新頻度**: synthetic monitoring から 1 分間隔で取得、status banner はインシデント
  発生時に手動更新
- **履歴**: 過去 90 日間の uptime と過去のインシデント詳細を公開

## 2. インシデント分類

ステータスページでは以下の状態を表示します:

| 状態               | 意味                                                      |
| ------------------ | --------------------------------------------------------- |
| **Operational**    | 全コンポーネントが正常稼働                                |
| **Degraded**       | 一部機能の遅延・部分障害・限定的影響 (SLA 違反は通常なし) |
| **Partial outage** | 一部の Installation / region / 機能が利用不可             |
| **Major outage**   | サービス全体または広範囲が利用不可                        |
| **Maintenance**    | 計画メンテナンス中 (SLA 計算から除外)                     |

詳細な SLA 計算と除外事由は [SLA](/legal/sla) を参照してください。

## 3. 過去の可用性

ステータスページは過去 12 ヶ月分の **月次可用性** を planned service ごとに公開します:

- Takos Web / API
- Git service profile
- Agent runtime profile
- Takosumi Accounts dashboard
- OIDC issuer
- Billing portal

各 planned service の SLA target との比較は [SLA](/legal/sla) §1 を参照。

## 4. 更新の購読

利用者は以下の手段でインシデント通知を受け取れます:

- **Email subscription**: ステータスページから email を登録 (`Subscribe to Updates`)
- **RSS / Atom**: `[STATUS_PAGE_URL]/history.rss`
- **Webhook**: 通知 webhook 登録 (dashboard `/notifications/webhooks` 経由)
- **Slack / Teams**: dashboard 統合経由で incident notification を直接受信

## 5. 障害報告

ステータスページに反映されていない障害を発見した場合、以下に連絡してください:

| 用途                  | 連絡先                      |
| --------------------- | --------------------------- |
| 障害報告 (一般)       | `[OPERATOR_EMAIL]`          |
| 緊急 (サービス全停)   | `[EMERGENCY_EMAIL]`         |
| サポート (ログイン後) | dashboard `/support`        |
| SLA クレーム          | [SLA](/legal/sla) §5 を参照 |

施行日: `[EFFECTIVE_DATE]`
