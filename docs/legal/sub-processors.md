# Legal: Sub-processors (Public Launch Baseline)

> このページでわかること: Takosumi リファレンスディストリビューションが
> public launch 時に利用する operator-side sub-processor の概要、用途、変更通知ポリシー。

**Template — operator review required before public launch.** 各 operator は
実装ディストリビューションに応じて sub-processor 一覧を確定する必要があります。

This page is the **public-launch operator-facing summary**. 契約上の正式な
sub-processor 一覧 (DPA 添付資料) は [Sub-processors](/legal/subprocessors)
を正本とします。本ページは public-facing 概要であり、両者は同期されている必要があります。

## Status

| Field         | Value                                                |
| ------------- | ---------------------------------------------------- |
| Owner         | Operator data protection owner                       |
| Last reviewed | `[EFFECTIVE_DATE]`                                   |
| Scope         | Takosumi reference distribution (public launch) |
| Status        | Template — pre-public-launch baseline                |

## 1. リファレンスディストリビューションの sub-processor

`[OPERATOR_NAME]` が運用する Takosumi リファレンスディストリビューションは、
以下の sub-processor を利用します:

| Provider                          | 役割                              | 用途                                            | Data category                            |
| --------------------------------- | --------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| Cloudflare, Inc.                  | Hosting / Edge compute / Storage  | Workers, D1, R2, KV, Queues, CDN, WAF           | Account, session, request, deployment    |
| Stripe, Inc. / Stripe EU          | Payment processor                 | サブスクリプション課金、請求書、税務            | Billing, customer ID, invoice metadata   |
| AWS SES または Postmark           | Transactional email               | アカウント認証メール、通知、請求メール          | Email address, message metadata          |
| Google LLC (OAuth)                | Identity provider (IdP)           | Google OAuth ログイン (利用者選択時のみ)        | OAuth subject, email, profile            |
| Apple Inc. (Sign in with Apple)   | Identity provider (IdP)           | Apple ID ログイン (利用者選択時のみ)            | OAuth subject, email relay               |
| GitHub, Inc.                      | Identity provider (IdP)           | GitHub OAuth ログイン (利用者選択時のみ)        | OAuth subject, email, profile            |
| `[MONITORING_VENDOR]`             | Monitoring / Synthetic check      | Uptime monitoring, alert routing                | Synthetic check metadata, alert events   |
| `[ERROR_TRACKING_VENDOR]`         | Error tracking                    | Production error logs (PII redacted)            | Stack traces, request IDs                |

詳細な data category、region behavior、official DPA 参照リンクは
[Sub-processors](/legal/subprocessors) を参照してください。

## 2. オプション機能で起動される sub-processor

以下の sub-processor は、顧客が明示的に該当機能を有効化した場合のみデータを処理します:

- **OpenAI**: AI agent feature (`OPENAI_API_KEY` configured 時)
- **AWS**: 顧客が AWS deployment target を選択した場合
- **Google Cloud**: 顧客が GCP deployment target を選択した場合
- **Customer-provided integrations**: 顧客がインストールした webhook / MCP / 外部 API

詳細は [Sub-processors](/legal/subprocessors) §Optional / Customer-selected Processing 参照。

## 3. オペレーター固有 sub-processor の差異

> **Note**: 本ページは Takosumi リファレンスディストリビューションの sub-processor
> 一覧です。**Alternative operator distribution (self-hosted / on-prem / 別 SaaS)
> は異なる sub-processor 構成を持つ場合があります**。
>
> 顧客は契約締結時に signed order form / DPA で実際の sub-processor 構成を確認してください。
> Takosumi 公式リファレンスディストリビューション以外のオペレーターは、自身の sub-processor
> 一覧を公開する責任を負います。

## 4. 変更通知ポリシー

- **新規 sub-processor 追加**: 本番環境で Customer Personal Data の処理を開始する
  **少なくとも 30 日前** に通知します。
- **通知方法**: 本ページ更新 + dashboard banner + 通知メール (`[NOTIFICATION_EMAIL]`)
- **顧客の異議申立権**: 顧客は通知から 30 日以内に書面で異議申立を行えます。当社は
  代替手段を提示するか、顧客は契約を解除できます (詳細は
  [DPA](/legal/data-processing-agreement) §6 参照)。
- **緊急変更**: セキュリティ脅威への対応で immediate 変更が必要な場合は事後通知。

## 5. 連絡先

| 用途                   | 連絡先              |
| ---------------------- | ------------------- |
| Sub-processor 関連問合せ | `[PRIVACY_EMAIL]`   |
| DPO                    | `[DPO_EMAIL]`       |

施行日: `[EFFECTIVE_DATE]`
