# 法務・コンプライアンス

> このページでわかること: Takos の法務関連ドキュメントの一覧と、GA 前に必要な対応。

契約・課金・アイデンティティはオペレーターの account plane (Takosumi Accounts) が所有します。
Takos 自体はアプリ内プロフィールと OIDC consumer 機能を提供します。
/ billing 境界を組み合わせて定義します。

## Published Artifacts

| Artifact                           | Path                                   | Status                                                                                     |
| ---------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| Data Processing Agreement template | `/legal/data-processing-agreement`     | Draft template; legal review required before signature                                     |
| Sub-processor list                 | `/legal/subprocessors`                 | Published baseline; vendor review evidence is private                                      |
| Data residency policy              | `/legal/data-residency`                | Published policy; enforcement evidence required before GA                                  |
| Privacy rights and lawful bases    | `/legal/privacy-rights`                | Published handler / consent / lawful-basis baseline; legal review required before GA       |
| Security disclosure policy         | `/legal/security-disclosure`           | Published policy; `security@` delivery evidence and PGP key publication required before GA |
| License compliance                 | `/legal/license-compliance`            | Published first-party license / REUSE / SPDX baseline                                      |
| Third-party dependency inventory   | `/legal/third-party-license-inventory` | Published lockfile and review-required package inventory                                   |
| SOC 2 readiness checklist          | `/legal/soc2-readiness`                | Readiness artifact; not an audit report                                                    |

## GA Blockers

- Privacy Policy and Terms of Service final legal review.
- Data residency enforcement evidence for production spaces.
- `security@takos.jp` inbound delivery evidence and PGP encrypted loopback
  proof.
- Third-party license inventory refresh on every dependency-changing release.
