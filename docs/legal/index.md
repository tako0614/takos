# 法務・コンプライアンス

> このページでわかること: Takos の法務関連ドキュメントの一覧と、operator-owned
> evidence boundary。

契約・課金・アイデンティティはオペレーターの account plane (Takosumi Accounts)
が所有します。 Takos 自体はアプリ内プロフィールと OIDC consumer
機能を提供します。法務上の customer counter-party、billing、Installation ledger
は operator account plane (リファレンス実装: Takosumi Accounts) の責務として定義します。

## Published Artifacts

| Artifact                           | Path                                   | Status                                                                              |
| ---------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- |
| Terms of Service template          | `/legal/terms-of-service`              | Public-launch template; operator legal review required before publishing            |
| Privacy Policy template            | `/legal/privacy-policy`                | Public-launch template; operator / DPO review required before publishing            |
| Acceptable Use Policy template     | `/legal/acceptable-use-policy`         | Public-launch template; trust & safety owner review required                        |
| Cookie Policy template             | `/legal/cookie-policy`                 | Public-launch template; matches Takos essential-cookie-only baseline                |
| Service Level Agreement template   | `/legal/sla`                           | Public-launch template; availability targets and credit policy placeholders         |
| Sub-processors public summary      | `/legal/sub-processors`                | Public-facing summary that points to the canonical `/legal/subprocessors` list      |
| Status Page reference              | `/legal/status-page`                   | Public-launch reference to `[STATUS_PAGE_URL]` and incident classification          |
| Data Processing Agreement template | `/legal/data-processing-agreement`     | Published template baseline; customer execution requires operator / legal approval  |
| Sub-processor list                 | `/legal/subprocessors`                 | Canonical published baseline; vendor review evidence is private                     |
| Data residency policy              | `/legal/data-residency`                | Published policy; per-tenant enforcement evidence is private                        |
| Privacy rights and lawful bases    | `/legal/privacy-rights`                | Published handler / consent / lawful-basis baseline                                 |
| Security disclosure policy         | `/legal/security-disclosure`           | Published policy; mailbox and encrypted-exchange evidence is private                |
| License compliance                 | `/legal/license-compliance`            | Published first-party license / REUSE / SPDX baseline                               |
| Third-party dependency inventory   | `/legal/third-party-license-inventory` | Published lockfile and review-required package inventory                            |
| SOC 2 readiness checklist          | `/legal/soc2-readiness`                | Readiness artifact; not an audit report                                             |

## Evidence Boundary

- Customer-specific order forms, signed DPAs, vendor review records, residency
  enforcement proof, mailbox delivery tests, and encrypted report handling
  evidence are stored privately by the operator.
- Public docs describe the policy and baseline contract shape; they do not
  publish customer-specific legal evidence or security operations artifacts.
- Dependency inventory and license review are refreshed on dependency-changing
  releases.
