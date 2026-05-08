# Legal

> このページでわかること: Takos の公開前 legal / compliance artifacts と、 GA
> 前に署名・法務 review が必要な境界。

Takos は Installable App Model 上の app として提供される product であり、
**契約・billing・identity の正本は Takosumi Account (Takosumi Accounts service)
が所有**します。Takos 自身は OIDC consumer + app-local profile を提供し、 public
API / UI の運用境界は `takos/app/` に置かれますが、account / authentication /
contract / billing は Takosumi Accounts に集約されます。 Takosumi kernel は
generic kernel (compute-only)、takosumi-git は installer / workflow / git bridge
であり、Takos の customer-facing legal surface は Takos Web / API + Takosumi
Accounts の identity / billing 境界を 組み合わせて定義します。

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
