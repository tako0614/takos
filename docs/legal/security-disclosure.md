# Security Disclosure Policy

> このページでわかること: Takos の脆弱性報告受付、responsible disclosure
> window、safe harbor、PGP key publication の運用境界。

| Field         | Value                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| Last reviewed | 2026-05-07                                                                                             |
| Owner         | Security owner / Takos app (`takos/app`)                                                               |
| Status        | Policy published; `security@takos.jp` delivery evidence and PGP key publication are required before GA |

## Scope

Takos の customer-facing security disclosure surface は Takos Web / API +
Takosumi Accounts (identity / billing owner) を中心に定義します。Takosumi kernel
は generic PaaS compute-only、takosumi-git は installer / workflow / git bridge
であり、Takos managed service として影響する場合は Takos security intake
が受け付け、必要に応じて Takosumi Accounts (identity / billing owner) を含む
owning product root へ triage します。

In scope:

- Takos Web / API (`takos/app`)
- Takos Git hosting (`takos/git`)
- Takos agent service (`takos/agent`)
- Takosumi Accounts (`takosumi.account.auth@v1` / `takosumi.account.billing@v1`)
  — identity / billing / AppInstallation owner; OIDC issuer, launch token JWS
  signing, AppGrant revocation, and pairwise OIDC subject derivation are in
  scope when Takos managed service is impacted
- Takos managed deployment artifacts under `takos/deploy/`
- Takos docs and public service configuration
- Takos default apps when deployed as part of Takos managed service

Out of scope:

- customer-owned applications deployed on Takos unless the issue affects Takos
  platform isolation, authentication, billing, or managed infrastructure
- social engineering, phishing, physical attacks, spam, or denial-of-service
  load testing
- destructive tests, persistence, malware, credential harvesting, or data
  exfiltration beyond the minimum needed to prove impact
- vulnerabilities in third-party services that do not expose Takos customer data
  or Takos control-plane integrity

## Contact

Report suspected vulnerabilities to `security@takos.jp`. Do not open public
issues or discussions with exploit details.

The public Web artifact is:

- `/.well-known/security.txt` on `https://takos.jp`
- policy URL: `https://docs.takos.jp/legal/security-disclosure`

Reports should include:

- affected product, URL, repo path, or API endpoint
- impact summary and affected data class
- reproduction steps with minimum necessary proof
- account / tenant identifiers used for testing, if any
- suggested mitigation or patch, if known
- whether you plan coordinated public disclosure

Do not include production secrets, private keys, raw access tokens, or customer
data. If sensitive evidence is necessary, first send a minimal report and wait
for an encrypted exchange path.

## PGP Key Publication

PGP encryption is required before GA for high-sensitivity reports. The public
key must be published at `https://docs.takos.jp/legal/security-pgp.asc`, and the
fingerprint must be listed in this policy after the key ceremony.

Before marking the disclosure process GA-ready, the security owner must store
private evidence that:

- `security@takos.jp` accepts inbound mail from outside the organization
- an encrypted loopback report can be decrypted by the security owner and deputy
- the published public key fingerprint matches the private key in custody
- key expiry, rotation owner, and revocation procedure are recorded

Until that evidence exists, reports to `security@takos.jp` should avoid exploit
payloads, secrets, and customer data.

## Responsible Disclosure Window

Takos asks reporters to coordinate public disclosure until maintainers have had
time to triage and remediate the issue.

| Severity                                                   | Acknowledgement | Initial triage   | Target mitigation                                                              |
| ---------------------------------------------------------- | --------------- | ---------------- | ------------------------------------------------------------------------------ |
| Critical active exploitation or cross-tenant data exposure | 1 business day  | 2 business days  | immediate containment, public incident process if customer impact is confirmed |
| Critical                                                   | 3 business days | 7 calendar days  | 15 calendar days                                                               |
| High                                                       | 3 business days | 7 calendar days  | 30 calendar days                                                               |
| Medium                                                     | 5 business days | 14 calendar days | 60 calendar days                                                               |
| Low / defense-in-depth                                     | 5 business days | 21 calendar days | 90 calendar days or next planned release                                       |

The default coordinated disclosure window is 90 calendar days from verified
report receipt. The security owner may request an extension when remediation
requires coordinated upstream fixes, customer migration time, or third-party
vendor action. Reporters may request earlier disclosure when the issue is
already publicly exploited or the fix is broadly deployed.

## Safe Harbor

Takos will not pursue legal action for good-faith security research that stays
within this policy, avoids privacy harm, and stops when a vulnerability is
confirmed. Researchers must:

- use their own account, tenant, repository, or test application whenever
  possible
- stop testing and report immediately if they access another user's data
- avoid degrading service availability or bypassing rate limits at scale
- avoid persistence, lateral movement, destructive actions, and data
  modification
- give Takos a reasonable chance to remediate before public disclosure

This safe harbor does not authorize activity against third-party systems,
customer-owned applications, or infrastructure outside Takos control.

## Triage and Remediation

Security reports are handled through the incident response process when customer
data, production credentials, availability, or cross-tenant isolation may be
affected.

Triage output must record:

- severity and confidence
- affected service owner
- affected data class and tenant boundary
- containment action, if required
- remediation owner and target date
- disclosure coordination status

Critical or high-severity issues must create private evidence that links the
report, fix, release, customer communication decision, and postmortem / RCA when
the incident response runbook requires one.
