# Legal: Sub-processor List

> このページでわかること: Takos が Customer Personal Data の処理で利用する
> sub-processor / third-party processor、目的、data category、optional provider
> の扱い、vendor onboarding rule。

This list is the public baseline for the Takos DPA template. It is not a
complete vendor risk file; private vendor security reviews, contract records,
and billing evidence stay in `takos-private` or the approved private evidence
store.

## Status

| Field                | Value                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                | Data protection owner                                                                                                                                                                 |
| Last reviewed        | 2026-05-07                                                                                                                                                                            |
| Applies to           | Takos Web / API, Takosumi Accounts (identity / billing processor), Takosumi/operator-managed deploy/runtime operations used by Takos spaces, Takos Git hosting, Takos agent execution |
| Related DPA          | `/legal/data-processing-agreement`                                                                                                                                                    |
| Change notice target | At least 30 days before new production processing where Customer notice rights apply                                                                                                  |

> **Internal processor boundary note.** Within the Takosumi / Takos ecosystem
> itself, **Takosumi kernel** is treated as the AppSpec / Deployment / resource
> graph / operator execution processor and never holds identity, billing,
> or customer account state. **Takosumi Accounts** (`identity.primary.oidc` /
> `billing.primary.default`) is the separate identity / billing processor that
> owns OIDC issuance, Installation ownership, and operator BillingPort billing.
> External sub-processors below are referenced by both planes only when the
> relevant feature is enabled.

## Core Providers

| Provider                                       | Role                                                                             | Purpose                                                                                                        | Customer Personal Data categories                                                                                                                          | Location / region behavior                                                                                         | Official source                                                                                                                                          |
| ---------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare, Inc. and affiliates                | Hosting / edge compute / storage / security processor                            | Takos Web / API hosting, Workers, D1, R2, KV, Queues, CDN / WAF, logs, and Cloudflare distribution operations  | Account identifiers, session metadata, request metadata, source artifacts, runtime logs, object storage, deployment metadata                               | Cloudflare global service; provider sub-processor list is maintained by Cloudflare                                 | [Cloudflare sub-processors](https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/)                                                          |
| OpenAI OpCo, LLC / OpenAI Ireland Ltd.         | AI model processor                                                               | Language model inference, embeddings, agent response generation, and AI feature support when enabled           | Prompts, messages, tool context, files or content submitted to AI features, generated outputs, request metadata                                            | OpenAI DPA identifies entity / transfer handling by customer region and refers to its sub-processor list           | [OpenAI DPA](https://openai.com/policies/data-processing-addendum/)                                                                                      |
| Stripe, Inc. / Stripe Payments Europe, Limited | Payment processor and payment controller depending on activity                   | Subscription billing, invoices, payment status, fraud prevention, tax and payment compliance                   | Billing contact data, email address, customer ID, subscription status, usage and invoice metadata; card numbers are handled by Stripe, not stored by Takos | Stripe DPA and services agreement define regional contracting entity and transfer terms                            | [Stripe DPA](https://stripe.com/legal/dpa)                                                                                                               |
| Google LLC / Google Ireland Limited            | Identity provider, optional AI provider, optional Google Cloud hosting processor | Google OAuth sign-in; optional Google AI API use; optional GCP / GKE hosting target where selected by operator | OAuth subject, email, name, avatar; optional AI prompts / outputs; optional deployment artifacts and logs for GCP-hosted deployments                       | Google Cloud location behavior follows selected services and regions; Google publishes DPA and sub-processor terms | [Google Cloud DPA](https://cloud.google.com/terms/data-processing-addendum), [Google Cloud sub-processors](https://cloud.google.com/terms/subprocessors) |
| Amazon Web Services, Inc. and AWS affiliates   | Optional infrastructure processor                                                | Optional AWS staging / production target, S3-compatible storage, Route53, CloudWatch, SES / SNS where enabled  | Deployment artifacts, object storage data, routing metadata, logs, alerts, support data shared by operator                                                 | Processing follows selected AWS Region plus AWS service-provider and support subprocessors                         | [AWS DPA](https://d1.awsstatic.com/legal/aws-gdpr/aws-gdpr-dpa-online.pdf), [AWS sub-processors](https://aws.amazon.com/compliance/sub-processors/)      |

## Optional / Customer-selected Processing

The following are not automatically authorized for every customer. They become
in scope only when Customer, operator, or a Takos app configuration enables the
feature:

| Provider class                      | Example trigger                                                                                                   | Handling rule                                                                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Customer app integrations           | Customer installs an app, MCP server, OAuth client, webhook, or external API connector                            | Customer owns the integration choice; Takos must show the integration boundary in product UI / docs                           |
| Customer-selected deployment target | Customer or operator deploys a Takos space to AWS, GCP, Kubernetes, self-hosted infrastructure, or another target | Target provider must appear in the signed order / deployment profile and this list before production personal-data processing |
| AI provider override                | Customer configures non-OpenAI model provider or custom `OPENAI_BASE_URL` equivalent                              | Vendor review and sub-processor list update required before Takos-managed production use                                      |
| Support tools                       | Customer submits support tickets, diagnostics, or incident evidence to a separate support system                  | Tool cannot receive Customer Personal Data until vendor review and DPA coverage are complete                                  |

## Not Sub-processors by Default

| System                                            | Reason                                                                                                                           |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions for OSS repository CI              | Processes source and CI metadata for Takos development, not customer production personal data by default                         |
| Deno / JSR package registry                       | Distributes packages; no Takos customer production personal data is sent by default                                              |
| Customer self-hosted databases / object stores    | Controlled by Customer or operator deployment choices, not a Takos-managed sub-processor unless Takos operates them for Customer |
| Prometheus / Grafana in self-hosted observability | Deployment-local tooling unless Takos uses a managed third-party observability vendor                                            |

## Vendor Onboarding Rule

Before a new provider processes Customer Personal Data in a Takos-managed
production environment, the service owner must:

1. Record provider name, service owner, feature trigger, processing purpose,
   data categories, regions, and official legal / security source links.
2. Confirm whether the provider acts as processor, sub-processor, independent
   controller, or mixed-role provider.
3. Complete privacy and security review and store evidence privately.
4. Confirm DPA / SCC / transfer mechanism coverage where required.
5. Update this list and notify affected customers according to the signed DPA.
6. Add rollback or provider-disable instructions for the affected feature.

## Official Source Links

Provider source links reviewed on 2026-05-07:

- Cloudflare sub-processors:
  <https://www.cloudflare.com/gdpr/subprocessors/cloudflare-services/>
- Stripe DPA: <https://stripe.com/legal/dpa>
- OpenAI DPA: <https://openai.com/policies/data-processing-addendum/>
- AWS DPA: <https://d1.awsstatic.com/legal/aws-gdpr/aws-gdpr-dpa-online.pdf>
- AWS sub-processors: <https://aws.amazon.com/compliance/sub-processors/>
- Google Cloud DPA: <https://cloud.google.com/terms/data-processing-addendum>
- Google Cloud sub-processors: <https://cloud.google.com/terms/subprocessors>
