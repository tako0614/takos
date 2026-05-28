# Legal: Privacy Policy

> このページでわかること: Takos / Takosumi Cloud リファレンスディストリビューションの
> public-facing プライバシーポリシーテンプレート。収集データ、利用目的、法的根拠、
> 国際移転、利用者の権利、DPO 連絡先。

**Template — operator review required before public launch.** This document is a
public-launch baseline template. Operators must review with qualified privacy
counsel and replace all placeholder fields before publishing to end users.

## Status

| Field         | Value                                                              |
| ------------- | ------------------------------------------------------------------ |
| Owner         | Operator data protection owner / DPO                               |
| Last reviewed | `[EFFECTIVE_DATE]`                                                 |
| Scope         | Takos Web / API, Takosumi Accounts, billing, agent execution       |
| Status        | Template — pre-public-launch baseline                              |

## 1. 適用範囲と controller / processor 役割

`[OPERATOR_NAME]` (以下「当社」) は、本サービス利用者の個人データを以下の役割で処理します。

| Plane                          | 役割             | 説明                                                                    |
| ------------------------------ | ---------------- | ----------------------------------------------------------------------- |
| Takosumi Cloud (Accounts plane) | 独立 controller | アカウント識別、認証、課金、不正対策、法令遵守                          |
| Takos product (app plane)       | processor       | 利用者が投入したチャット / リポジトリ / AI エージェント context を処理 |

この区別は [Data Processing Agreement](/legal/data-processing-agreement) と
[Privacy Rights](/legal/privacy-rights) で詳細に定義されています。

## 2. 収集するデータ

### 2.1 アカウントデータ (controller として処理)

- 氏名・表示名・メールアドレス
- OIDC subject (Google / Apple / GitHub 等の IdP が発行する識別子)
- passkey credential metadata
- ログイン履歴・IP アドレス・user agent

### 2.2 課金データ (controller として処理)

- 請求先情報 (会社名、住所、税番号)
- サブスクリプションプラン、使用量メトリクス、請求書、支払いステータス
- カード番号自体は Stripe が処理し、当社は保存しません

### 2.3 利用データ (controller として処理)

- 機能利用イベント、API 呼び出しメトリクス、deployment ログ
- エラーログ、パフォーマンスメタデータ

### 2.4 AI エージェント context (processor として処理)

- 利用者が AI エージェントに投入したプロンプト、添付ファイル、ツール呼び出し履歴
- AI エージェントが生成した output、memory store の内容
- 詳細な処理範囲は [Data Processing Agreement](/legal/data-processing-agreement) §3〜§4 を参照

## 3. 利用目的と法的根拠

| 目的                            | 法的根拠 (GDPR Art. 6 / APPI)              |
| ------------------------------- | ------------------------------------------ |
| サービス提供と契約履行          | 契約履行 (Art. 6(1)(b))                    |
| 認証・アクセス制御              | 契約履行・正当な利益 (Art. 6(1)(b)/(f))    |
| 請求・税務                      | 契約履行・法令遵守 (Art. 6(1)(b)/(c))      |
| セキュリティ監視・不正対策      | 正当な利益・法令遵守 (Art. 6(1)(f)/(c))    |
| プロダクト信頼性向上            | 正当な利益 (Art. 6(1)(f))                  |
| マーケティング (newsletter 等)  | 同意 (Art. 6(1)(a))                        |
| Cookie / UI 個人設定の保存      | 同意 (Art. 6(1)(a))                        |

APPI (個人情報の保護に関する法律) のもとでは、上記目的に対応する第 17 条 (利用目的の特定)
および第 18 条 (利用目的の通知・公表) の要件を満たします。

## 4. 第三者との共有・sub-processor

当社は利用者の個人データを以下の sub-processor および第三者と共有することがあります:

- 共有先一覧と役割は [Sub-processors](/legal/sub-processors) を参照
- 共有は当該 sub-processor との DPA / SCC / transfer mechanism に従う
- 法令・裁判所命令に基づく開示要求は [Data Processing
  Agreement](/legal/data-processing-agreement) §9 に従う

## 5. データ保持期間

| データ種別          | 保持期間                                                  |
| ------------------- | --------------------------------------------------------- |
| アカウントデータ    | アカウント有効期間 + `[ACCOUNT_RETENTION_DAYS]` 日         |
| 課金データ          | 法令で要求される期間 (日本の場合は 7 年)                  |
| 利用・監査ログ      | `[AUDIT_RETENTION_DAYS]` 日                                |
| AI エージェント context | Installation 削除時に削除 (privacy-rights handler に従う) |

## 6. 利用者の権利

利用者は GDPR / CCPA / APPI のもとで以下の権利を有します:

- アクセス権、訂正権、削除権 (忘れられる権利)、移行権 (data portability)
- 処理停止権、自動意思決定に対する異議申立権
- 同意撤回権 (撤回前の処理は影響を受けない)

行使方法と handler 仕様は [Privacy Rights](/legal/privacy-rights) を参照してください。
監督機関への申立権は当社対応とは独立して保証されます。

## 7. 国際データ移転

- EU / UK / 日本の利用者データを第三国に移転する場合、Standard Contractual
  Clauses (SCC) または同等の transfer mechanism を適用します。
- データ所在地ポリシーは [Data Residency](/legal/data-residency) を参照。

## 8. セキュリティ対策

- 暗号化 (転送時 TLS 1.2+、保管時 AES-256)
- access control / RBAC、audit log、incident response 体制
- vendor security review、SOC 2 readiness ([SOC 2
  Readiness](/legal/soc2-readiness) を参照)
- 詳細は [Security Disclosure](/legal/security-disclosure) を参照

## 9. 児童のプライバシー

本サービスは 13 歳未満 (`[JURISDICTION_OVERRIDE]` により異なる)
の方を対象としていません。13 歳未満の方からデータを意図せず収集した場合、速やかに
削除します。

## 10. 本ポリシーの変更

本ポリシーを変更する場合、施行日の少なくとも 30 日前に通知します。重大でない変更は
ウェブサイト上の更新で告知します。

## 11. 連絡先

| 用途                       | 連絡先              |
| -------------------------- | ------------------- |
| プライバシー全般           | `[PRIVACY_EMAIL]`   |
| データ保護責任者 (DPO)     | `[DPO_EMAIL]`       |
| EU 代理人 (該当する場合)   | `[EU_REP_EMAIL]`    |
| 住所                       | `[OPERATOR_ADDRESS]` |

施行日: `[EFFECTIVE_DATE]`
