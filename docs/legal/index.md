# Legal

> このページでわかること: Takos の公開前 legal / compliance artifacts と、
> GA 前に署名・法務 review が必要な境界。

Takos は基本の利用面を Web / API として提供する product であり、account、
authentication、profile、billing、public API、UI の正本は `takos/app/`
です。Takosumi は generic PaaS kernel、takosumi-git は workflow / git bridge
であり、Takos の customer-facing legal surface は Takos Web / API とその運用
境界を中心に定義します。

## Published Artifacts

| Artifact | Path | Status |
| --- | --- | --- |
| Data Processing Agreement template | `/legal/data-processing-agreement` | Draft template; legal review required before signature |
| Sub-processor list | `/legal/subprocessors` | Published baseline; vendor review evidence is private |
| SOC 2 readiness checklist | `/legal/soc2-readiness` | Readiness artifact; not an audit report |

## GA Blockers

- Privacy Policy and Terms of Service final legal review.
- Data subject access / export / deletion handler.
- Cookie consent and lawful-basis documentation.
- Data residency policy.
- Security disclosure policy with working `security@` intake and PGP key.
- License inventory and third-party license review.
