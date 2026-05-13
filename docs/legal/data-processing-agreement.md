# Legal: Data Processing Agreement Template

> このページでわかること: Takos の customer DPA template、processing scope、
> security measures、sub-processor approval flow、operator-owned execution
> boundary。

This document is the public template baseline for a customer Data Processing
Agreement (DPA). It is not legal advice and is not a signed agreement. Customer
execution requires the applicable operator order form, legal approval, and
signature process.

## Status

| Field            | Value                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| Owner            | Data protection owner                                                                                  |
| Last reviewed    | 2026-05-07                                                                                             |
| Scope            | Takos Web / API, Takos Git hosting, Takos agent execution, and Takosumi/operator-managed deploy/runtime operations used by Takos spaces |
| Current status   | Public template baseline                                                                               |
| Signature status | Customer execution requires operator / legal approval and a signed order                               |

## Regulatory Baseline

This template is designed around:

- GDPR Article 28 processor contract requirements: subject matter, duration,
  nature and purpose, personal data categories, data subject categories,
  controller instructions, confidentiality, security, sub-processor flowdown,
  assistance, return/deletion, and audit information.
- CCPA / CPRA service-provider and contractor contract requirements: limited
  purpose, no selling or sharing, no processing outside the business
  relationship, assistance with consumer requests, and subcontractor flowdown.

Official source links are listed at the end of this page.

## 1. Parties and Roles

`Customer` means the **Takosumi Account holder** named in the signed order form
or master agreement. The Takosumi Account holder is the legal counter-party for
contract, billing, and DPA signature purposes, and is fixed for the life of the
DPA.

`AppInstallation owner` means the operational owner of a specific Takos
AppInstallation under that Takosumi Account (per Space). The AppInstallation
owner acts as Customer's **delegated agent** for app-local configuration and
data subject request handling, but is not itself the DPA signatory.

`Takos` means the Takos service operator identified in the signed order form or
master agreement.

Legal continuity rule: AppInstallation export, dedicated materialization, or
re-binding may move the AppInstallation owner role within the Customer's scope,
but the **DPA Customer remains the Takosumi Account holder**. Transferring the
DPA Customer to a different Takosumi Account (e.g., AppInstallation export to a
separate takosumi instance owned by a different account) requires a separate
contract assignment, not an AppInstallation lifecycle event.

For Customer Personal Data processed through Takos spaces, repositories,
deployments, agent runs, support requests, and customer-managed applications:

| Party                              | Default role                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Customer (Takosumi Account holder) | Controller, or processor where Customer processes data for its own end customer                                     |
| AppInstallation owner              | Customer's delegated agent for app-local processing decisions; does not change Customer's controller/processor role |
| Takos                              | Processor, or sub-processor where Customer is a processor                                                           |

The Takos service operator or operator account-plane provider may act as an
independent controller for account administration, security, billing, fraud
prevention, service analytics, and legal compliance. Those controller activities
belong in the Privacy Policy and Terms of Service, not this DPA template. This
does not make the Takos product the OIDC issuer, billing owner, or
AppInstallation ledger owner.

## 2. Customer Instructions

Takos processes Customer Personal Data only according to documented Customer
instructions, except where applicable law requires otherwise. Documented
instructions include:

- the signed agreement and order form
- workspace, deployment, and app configuration selected through Takos Web / API
- support requests made by authorized Customer users
- written instructions accepted by the Takos data protection owner

Takos must notify Customer if Takos believes an instruction violates applicable
data protection law, unless legally prohibited.

## 3. Details of Processing

| Item               | Description                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Subject matter     | Providing Takos Web / API access, spaces, source and repository services, Takosumi-backed deploy orchestration, agent execution, operator account-plane billing usage, support, and security operations |
| Duration           | Agreement term plus the deletion / retention period required to close the account, resolve disputes, comply with law, and maintain security evidence               |
| Nature and purpose | Hosting, storing, transmitting, indexing, generating, deploying, monitoring, securing, supporting, and deleting Customer-controlled content and metadata           |
| Frequency          | Continuous while Customer uses Takos                                                                                                                               |
| Data subjects      | Customer admins, members, collaborators, application end users, support contacts, and people whose data Customer submits to Takos                                  |

## 4. Personal Data Categories

Takos may process the following categories where Customer uses the relevant
feature:

- account identity data: name, email address, avatar, pairwise OIDC subject
  (per-installation, issued by Takosumi Accounts), authentication metadata
- workspace and access data: organization, space, role, membership, invitation,
  API token, session, and audit metadata
- repository and deployment data: repository metadata, commit metadata, source
  artifacts, deployment manifests, environment variable names, build logs, and
  runtime logs
- agent and application data: prompts, messages, tool inputs / outputs, uploaded
  files, generated artifacts, and Customer application data
- billing and usage data: plan, subscription identifiers, usage quantities,
  invoice status, payment status, and tax / billing contact data
- security and operations data: IP address, user agent, request IDs, trace IDs,
  incident evidence, backup records, and access logs

Customer must not submit special-category or sensitive personal data unless the
signed agreement, product configuration, and security review explicitly permit
that use case.

## 5. Sub-processors

Customer gives Takos general written authorization to use the sub-processors
listed in `/legal/subprocessors`.

Before authorizing a new sub-processor that will process Customer Personal Data,
Takos must:

- document the service owner, processing purpose, data categories, and official
  DPA / sub-processor source links
- complete vendor security and privacy review, storing evidence privately
- impose written data protection obligations that are materially comparable to
  this template
- remain responsible to Customer for Takos obligations delegated to the
  sub-processor
- update the published sub-processor list at least 30 days before production
  processing where Customer notice rights apply

Customer may object in writing during the notice period on reasonable data
protection grounds. If the objection cannot be resolved, Customer may stop using
the affected feature or terminate the affected order according to the signed
agreement.

## 6. Security Measures

Takos must maintain technical and organizational measures appropriate to the
risk of processing, including:

| Control area             | Baseline measure                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Access control           | Named user access, least privilege, service-owner review, break-glass logging                    |
| Authentication           | OAuth / session controls, API token verification, internal service signatures                    |
| Encryption               | TLS in transit; managed storage encryption or equivalent at rest                                 |
| Secrets                  | Secrets managed through `takos-private` / operator secret stores; no secrets in OSS source paths |
| Change management        | PR review, release gate, migration safety gate, patch management gate                            |
| Logging                  | Request correlation, audit logs, redaction of secrets and sensitive values                       |
| Backups                  | Backup / restore cadence and retention documented in operations runbooks                         |
| Incident response        | SEV policy, incident response runbook, customer notification process                             |
| Vulnerability management | Dependency update policy, Trivy scan, severity-based remediation SLA                             |
| Data deletion            | Account / space deletion workflow and retention exceptions documented by the operator            |

## 7. Data Subject Requests

Takos must assist Customer with access, export, correction, and deletion
requests to the extent Customer Personal Data is processed by Takos.

Customer execution requires operator approval that the data subject rights
handler, manual fallback, and operational owner are recorded for the applicable
managed environment.

## 8. Personal Data Breach

Takos must notify Customer without undue delay after confirming a Personal Data
Breach affecting Customer Personal Data. The notice should include known facts,
affected data categories, mitigation actions, and Customer-facing next steps.

The target external notification deadline is within 72 hours of confirmation
unless law enforcement, legal privilege, or incomplete investigation facts
require a different handling path approved by the incident commander and legal
owner.

## 9. Return, Deletion, and Retention

On termination or Customer instruction, Takos must return or delete Customer
Personal Data unless retention is required for legal, tax, security, fraud
prevention, dispute, backup, or audit reasons.

Retention exceptions must be isolated from active processing and deleted when
the exception expires. Backup deletion may follow the documented backup
expiration cycle.

## 10. International Transfers

Where Customer Personal Data is transferred from the EEA, UK, Switzerland, or
another jurisdiction with transfer restrictions, the signed DPA must include an
approved transfer mechanism such as the applicable Standard Contractual Clauses,
UK Addendum, adequacy decision, Data Privacy Framework coverage, or another
lawful transfer mechanism accepted by counsel.

The published sub-processor list must identify provider region behavior and
official provider transfer documentation where available.

## 11. Audit and Evidence

Takos must make reasonable compliance information available to Customer,
including public policies, security summaries, and relevant audit evidence.
Customer audit requests must be scoped, confidential, no more than once per year
unless required after a verified breach, and must not expose other customers'
data or Takos trade secrets.

## 12. CCPA / CPRA Service Provider Terms

Where CCPA / CPRA applies and Takos acts as a service provider or contractor,
Takos must:

- process Customer Personal Data only for the specific business purposes in the
  signed agreement
- not sell or share Customer Personal Data
- not retain, use, or disclose Customer Personal Data outside the direct
  business relationship except as permitted by law
- provide the same level of privacy protection required by applicable CCPA /
  CPRA service-provider terms
- assist Customer with consumer requests
- require subcontractors that process Customer Personal Data to meet comparable
  obligations
- notify Customer if Takos determines it can no longer meet these obligations

## Annex I: Processing Details

| Field                       | Template value                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Data exporter               | Customer                                                                                                         |
| Data importer               | Takos                                                                                                            |
| Processing purpose          | Providing Takos Web / API, Takosumi-backed deploy/runtime operation, Git hosting, agent execution, operator account-plane billing usage, support, and security operations |
| Categories of data subjects | Customer users, Customer collaborators, Customer application users, support contacts                             |
| Categories of personal data | Identity, access, repository, deployment, agent, application, billing, telemetry, support, and security data     |
| Sensitive data              | Not intended unless separately agreed                                                                            |
| Transfer frequency          | Continuous while Customer uses Takos                                                                             |
| Retention                   | Agreement term plus documented retention exceptions                                                              |

## Annex II: Technical and Organizational Measures

The baseline measures are the controls listed in Section 6 plus the public
operations documents for on-call, incident response, backup / restore, disaster
recovery, capacity planning, cost monitoring, patch management, and online DB
migration safety.

## Annex III: Authorized Sub-processors

The authorized sub-processor list is published at `/legal/subprocessors` and is
incorporated by reference into the signed DPA once legal review approves that
contract structure.

## Official Source Links

- GDPR Regulation (EU) 2016/679, including Article 28:
  <https://eur-lex.europa.eu/eli/reg/2016/679/oj>
- CCPA / CPRA regulations, Section 7051:
  <https://cppa.ca.gov/regulations/pdf/cppa_regs.pdf>
- Cloudflare sub-processors:
  <https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/>
- Stripe DPA: <https://stripe.com/legal/dpa>
- OpenAI DPA: <https://openai.com/policies/data-processing-addendum/>
- AWS DPA: <https://d1.awsstatic.com/legal/aws-gdpr/aws-gdpr-dpa-online.pdf>
- AWS sub-processors: <https://aws.amazon.com/compliance/sub-processors/>
- Google Cloud DPA: <https://cloud.google.com/terms/data-processing-addendum>
- Google Cloud sub-processors: <https://cloud.google.com/terms/subprocessors>
