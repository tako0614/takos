# Legal: Terms of Service

> このページでわかること: Takos / Takosumi Cloud のリファレンスディストリビューションを
> public launch するオペレーター向けの Terms of Service (利用規約) テンプレート。
> 契約上の counter-party、利用制限、責任制限、解約、準拠法。

**Template — operator review required before public launch.** This document is a
public-launch baseline template. Operators must review with qualified legal
counsel and replace all placeholder fields before publishing to end users.

## Status

| Field            | Value                                                  |
| ---------------- | ------------------------------------------------------ |
| Owner            | Operator legal owner                                   |
| Last reviewed    | `[EFFECTIVE_DATE]`                                     |
| Scope            | Takos Web / API, Takos Git, Takos agent, bundled apps  |
| Current status   | Template — pre-public-launch baseline                  |
| Signature status | Click-through acceptance; not a signed master contract |

## 1. 定義

本利用規約 (以下「本規約」) は、`[OPERATOR_NAME]` (以下「当社」) が提供する Takos /
Takosumi Cloud リファレンスディストリビューション (以下「本サービス」) の利用に関する条件を
定めるものです。

- **「利用者」**: 本サービスを利用するために Takosumi Account を作成した自然人または法人
- **「アカウント保有者」**: Takosumi Account の所有者であり、契約上の counter-party
- **「Installation」**: Takosumi が `.takosumi.yml` を読み取って Space に作成する deployment unit
- **「Customer Personal Data」**: 利用者が本サービスに投入した個人データ
  ([Data Processing Agreement](/legal/data-processing-agreement) を参照)

## 2. アカウント作成と認証

- アカウント作成には有効なメールアドレスと、対応する OIDC IdP (Google / Apple / GitHub
  等) または passkey の登録が必要です。
- 利用者は登録情報を正確かつ最新に保つ義務があります。
- 一つのアカウントを複数人で共有することはできません。組織利用の場合は Installation owner
  delegation を使用してください。
- 13 歳未満 (`[JURISDICTION_OVERRIDE]` により異なる) の方は本サービスを利用できません。

## 3. 許容される利用

利用者は本サービスを [Acceptable Use Policy](/legal/acceptable-use-policy) に従って
利用するものとし、以下の行為を行ってはなりません:

- 違法・有害・侵害的コンテンツの送信または保存
- 他者の権利・プライバシー・知的財産権の侵害
- 本サービスのインフラに対する攻撃・不正アクセス試行
- AI エージェント機能を用いた悪意ある自動化・prompt injection 攻撃
- 当社事前許可のないセキュリティテスト

詳細は [Acceptable Use Policy](/legal/acceptable-use-policy) を参照してください。

## 4. サービス可用性

- 当社は本サービスを可用性目標
  ([SLA](/legal/sla) に定める shared-cell 99.5% / dedicated 99.9%) に従い提供します。
- 計画メンテナンス、不可抗力、利用者起因の障害は SLA の除外事由です。
- ステータス情報は [Status Page](/legal/status-page) で公開されます。

## 5. 料金と解約

- 料金プラン・課金サイクル・税金は Takosumi Accounts 上の order form に従います。
- 利用者は dashboard からいつでもサブスクリプションをキャンセルできます。キャンセルは
  当該課金サイクル末日に有効となり、日割り返金は行いません (法令で別段の定めがある場合を除く)。
- 支払い遅延が `[GRACE_PERIOD]` 日継続した場合、当社は本サービスの停止または契約解除を
  行うことがあります。
- 解約後の Customer Personal Data の返却・削除は [Data Processing
  Agreement](/legal/data-processing-agreement) に従って処理されます。

## 6. 知的財産権とコンテンツ所有権

- 本サービス自体、ソフトウェア、ドキュメント、商標は当社または licensor が所有します。
- 利用者が本サービスに投入したコンテンツ (チャット、リポジトリ、AI エージェントの input /
  output 等) の所有権は利用者に帰属します。
- 利用者は本サービスを提供するために必要な範囲で、当該コンテンツを処理・保存・複製する
  非独占ライセンスを当社に付与します。
- フィードバック (バグ報告、機能提案等) は当社が制限なく利用できるものとします。

## 7. 責任制限

- 法令で許容される最大限において、当社の本サービスに関する累積責任は、直近 12
  ヶ月間に利用者が当社に支払った金額を上限とします。
- 当社は間接損害、特別損害、結果的損害、逸失利益、データ損失について責任を負いません
  (法令で別段の定めがある場合を除く)。
- 本サービスは「現状のまま」提供され、商品性・特定目的適合性・第三者権利非侵害に関する
  黙示の保証を行いません。

## 8. 補償

利用者は、利用者による本規約違反、コンテンツ起因の第三者請求、Acceptable Use Policy
違反から生じる請求について、当社を補償するものとします。

## 9. 解除

- 利用者は dashboard から随時アカウントを閉鎖できます。
- 当社は利用者の重大な本規約違反、支払い不履行、または法令違反が認められた場合、
  通知のうえ本サービスを解除できます。
- 解除後、Customer Personal Data の削除は [Privacy Rights](/legal/privacy-rights)
  に従って処理されます。

## 10. 準拠法と紛争解決

- 本規約は日本法を準拠法とします (`[JURISDICTION_OVERRIDE]` により別段の定めがある場合を除く)。
- 本規約に関する紛争は東京地方裁判所を第一審の専属的合意管轄裁判所とします
  (`[JURISDICTION_OVERRIDE]` により別段の定めがある場合を除く)。

## 11. 規約変更

- 当社は本規約を変更することができます。重大な変更は施行日の少なくとも 30
  日前に通知します。
- 変更後の本サービス利用継続は、変更後の本規約への同意とみなされます。

## 12. お問い合わせ

| 用途             | 連絡先                |
| ---------------- | --------------------- |
| 一般問い合わせ   | `[OPERATOR_EMAIL]`    |
| 法務             | `[LEGAL_EMAIL]`       |
| 住所             | `[OPERATOR_ADDRESS]`  |
| データ保護責任者 | `[DPO_EMAIL]`         |

施行日: `[EFFECTIVE_DATE]`
