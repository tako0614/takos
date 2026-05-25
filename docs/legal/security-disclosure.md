# Security Disclosure Policy

> このページでわかること: Takos の脆弱性報告受付、responsible disclosure
> window、safe harbor、PGP key publication の運用境界。

| Field         | Value                                                                         |
| ------------- | ----------------------------------------------------------------------------- |
| Last reviewed | 2026-05-07                                                                    |
| Owner         | Security owner / Takos app (`takos/app`)                                      |
| Status        | Published policy; mailbox and encrypted-exchange evidence is operator-private |

## Scope

Takos の customer-facing security disclosure surface は Takos Web / API +
Takosumi Accounts (identity / billing owner) を中心に定義します。Takosumi kernel
は generic PaaS の AppSpec / Deployment / resource graph / provider
materialization surface、takosumi は installer / Deployment lifecycle
であり、Takos managed service として影響する場合は Takos security intake
が受け付け、必要に応じて Takosumi Accounts (identity / billing owner) を含む
owning product root へ triage します。

In scope:

- Takos Web / API (`takos/app`)
- Takos Git hosting (`takos/git`)
- Takos agent service (`takos/agent`)
- Takosumi Accounts (`operator.identity.oidc` / `operator.billing.default`) —
  identity / billing / Installation owner; OIDC issuer, opaque launch token
  redeem, account-plane capability record revocation, and pairwise OIDC subject
  derivation are in scope when Takos managed service is impacted
- managed Takos deployment artifacts under `takos/deploy/`
- Takos docs and public service configuration
- Takos bundled apps when deployed as part of Takos managed service

Out of scope:

- customer-owned applications installed or deployed on the operator's Takosumi
  instance unless the issue affects Takosumi platform isolation, Takos product
  service isolation, authentication, billing, or managed infrastructure
- social engineering, phishing, physical attacks, spam, or denial-of-service
  load testing
- destructive tests, persistence, malware, credential harvesting, or data
  exfiltration beyond the minimum needed to prove impact
- vulnerabilities in third-party services that do not expose Takos customer
  data, Takosumi kernel/operator account-plane integrity, or Takos product
  service integrity

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

Public PGP key publication is optional until the operator has generated,
reviewed, and privately stored the key custody evidence. When published, the
public key is served at `https://docs.takos.jp/legal/security-pgp.asc`, and the
fingerprint is listed in this policy.

## Encrypted Evidence Exchange

High-sensitivity reports should use an encrypted exchange path coordinated by
the security owner.

The security owner stores private evidence that:

- `security@takos.jp` accepts inbound mail from outside the organization
- an encrypted loopback report can be decrypted by the security owner and deputy
- any published public key fingerprint matches the private key in custody
- key expiry, rotation owner, and revocation procedure are recorded

Reports to `security@takos.jp` should avoid exploit payloads, secrets, and
customer data until the reporter and security owner agree on the encrypted
exchange path.

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
requires coordinated upstream fixes, customer remediation coordination, or
third-party vendor action. Reporters may request earlier disclosure when the
issue is already publicly exploited or the fix is broadly deployed.

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
