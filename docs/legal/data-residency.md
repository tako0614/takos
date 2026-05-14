# Legal: Data Residency Policy

> このページでわかること: Takos の residency profile、data class ごとの region rule、provider-specific limitation、GA
> evidence boundary。

This policy defines how Takos offers regional handling of Customer Personal Data. It is a product and operations policy,
not a guarantee that every sub-processor can be forced into one jurisdiction for every processing purpose. Customer
contracts must reference the exact residency profile, provider set, and exceptions that apply to that customer.

## Status

| Field          | Value                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Owner          | Data protection owner                                                                                  |
| Last reviewed  | 2026-05-07                                                                                             |
| Scope          | Takos Web / API, Takos Git hosting, Takos agent execution, Takosumi/operator-managed deploy/runtime operations used by Takos spaces |
| Current status | Published policy                                                                                       |
| Evidence rule  | Production spaces record residency profile, primary region, provider set, and approved exceptions      |

## Boundary

Takos is delivered through the Installable App Model. Account, authentication, contract, and billing are owned by
**Takosumi Accounts** (the Takosumi Account home region applies). Takos `takos/app` provides the public API / UI surface
and stores app-local profile derived from the Takosumi Accounts subject in the same residency profile. Takosumi kernel
is the generic PaaS compute substrate and takosumi-git is the installer / workflow / git bridge; they inherit residency
requirements only when Takos uses them to operate a customer space or deployment.

Residency decisions attach to the customer space / deployment profile, not to a local CLI convention.

## Residency Profiles

| Profile  | Customer-facing meaning                                                                                                                                                    | Required production handling                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `global` | No strict regional commitment. Suitable for development, pilots, public docs, or customers without residency requirements.                                                 | Data may be processed by approved providers in their normal service locations.                                             |
| `us`     | Customer workload data should be stored and processed in the United States where the provider supports it.                                                                 | Use US cloud regions, US-capable AI project configuration, and US metadata/logging controls where available.               |
| `eu`     | Customer workload data should be stored and processed in the EEA / Switzerland where the provider supports it.                                                             | Use EU cloud regions, EU-capable AI project configuration, and EU metadata/logging controls where available.               |
| `jp`     | Customer workload data should be stored in Japan where the provider supports it. Processing may require explicit exceptions for services that only offer regional storage. | Use Japan cloud regions and Japan-capable provider storage. Any out-of-region processing must be recorded as an exception. |

No paid production tenant may be onboarded with a residency commitment unless the order form or private deployment
record names the profile, primary region, and any approved exceptions.

## Data Class Rules

| Data class                                                   | Residency rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account identity and authentication metadata                 | **AppInstallation 台帳** (ownership ledger / pairwise OIDC subject / AppGrant) follows the **Takosumi Account home region** stored by the operator account plane (reference impl: Takosumi Accounts). Takos itself is an OIDC consumer and stores **app-local profile fields** (chat / memory / preferences / app-local cache derived from the account-plane subject) in the **AppInstallation primary region** declared by the residency profile. Under default deploys the Takosumi Account home region and the AppInstallation primary region are the same; cross-region installs may separate them and are recorded as a residency exception with both regions named. Google OAuth and other upstream identity providers may process authentication data under their own regional terms. |
| Billing and payment metadata                                 | Stripe or the operator-selected payment provider handles card and payment processing under its terms. Billing identifiers, invoices, subscription state, and payment status are owned by the operator account plane / BillingPort. Takos stores only app-local usage or metering mirrors needed to report AppInstallation usage back to `operator.billing.default`.                                                                                                                                                                                                                                                                                                                                                                                       |
| Space data and application data                              | Stored in the residency profile's primary region when Takos operates the storage provider for Customer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Git repositories and source artifacts                        | Stored in the residency profile's primary region when hosted by Takos Git or Takos-managed object storage.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Deployment manifests, build artifacts, and runtime bundles   | Stored in the selected deployment target region. Cross-region promotion is a profile-change operation and requires approval.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Agent prompts, messages, tool context, files, and AI outputs | Sent only to an AI provider/project compatible with the residency profile, or treated as an explicit out-of-region processing exception.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Runtime logs, audit logs, and telemetry                      | Stored in-region where provider controls support it. Security, abuse, and operational logs may have narrow exceptions documented in the order or incident record.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Backups and DR copies                                        | Stay in the same residency profile unless Customer approves a cross-region DR exception.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Support exports and incident evidence                        | May leave the profile only with Customer approval, legal requirement, or incident commander approval recorded in the incident timeline.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Provider-specific Handling

| Provider     | Policy requirement                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare   | Use Regional Services and Customer Metadata Boundary where a strict EU or US profile depends on Cloudflare edge / log controls. Cloudflare notes that Customer Metadata Boundary is an Enterprise Data Localization Suite feature and that some operational/account/configuration metadata is outside the boundary. |
| AWS          | Use the Customer-selected AWS Region for workload storage and processing. AWS DPA terms state that Customer can specify Regions and AWS will not transfer Customer Data from selected Regions except for service, law, or valid order needs.                                                                        |
| Google Cloud | Use specific Google Cloud regions for GKE / storage / database resources and verify each selected service supports data residency for the requested location.                                                                                                                                                       |
| OpenAI       | Configure data residency per OpenAI API project where AI features are in scope. US and Europe currently support regional storage and processing; non-US regions may require approved abuse-monitoring controls or Zero Data Retention and may support regional storage without regional processing.                 |
| Stripe       | Treat payment processing as a mixed-role / payment-network exception. Takos cannot promise strict workload-region residency for card network, tax, fraud, or compliance processing handled by Stripe.                                                                                                               |
| Google OAuth | Treat identity-provider authentication as a third-party identity processing exception unless a customer-specific enterprise identity arrangement provides stricter terms.                                                                                                                                           |

## Operational Requirements

Every production space with a residency commitment must have:

1. `residencyProfile`: one of `global`, `us`, `eu`, or `jp`.
2. `primaryRegion`: the cloud/provider region used for authoritative storage.
3. `allowedProviders`: the approved provider list for hosting, storage, AI, identity, billing, logging, and support.
4. `exceptions`: provider, data class, purpose, duration, and approval owner for any out-of-profile processing.
5. `profileChangePlan`: documented steps for changing profile or primary region.
6. `evidencePath`: private deployment record, order form, or customer security packet proving the profile was configured
   before production traffic.

Cross-region replication, DR copies, support exports, and model-provider fallbacks are disabled by default for strict
`us`, `eu`, and `jp` profiles unless an exception is recorded.

## Enforcement Evidence

For a managed production tenant with a residency commitment, the operator keeps
private evidence for the configured profile:

| Evidence            | Required proof                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| Region binding      | Deployment profile or private config maps the space to the selected provider region.                 |
| Storage location    | Database, object storage, repository storage, and backup targets are in the selected region/profile. |
| AI routing          | AI requests use the region-specific provider project / endpoint or the customer has an exception.    |
| Logging location    | Runtime, audit, and telemetry storage location is documented.                                        |
| Access log          | Out-of-region administrative/support access is logged or disabled.                                   |
| Sub-processor match | Active providers match `/legal/subprocessors`.                                                       |

## Customer Disclosure

Customer-facing proposals and order forms must avoid broad claims such as "all data stays in region" unless every data
class and provider exception has been reviewed. Use the narrower wording:

> Takos stores Customer workload data in the selected residency profile where the configured provider supports regional
> storage. Identity, payment, support, security, abuse monitoring, and selected AI processing may follow
> provider-specific terms or documented exceptions.

## Official Source Links

Provider source links reviewed on 2026-05-07:

- Cloudflare Customer Metadata Boundary: <https://developers.cloudflare.com/data-localization/metadata-boundary/>
- Cloudflare Customer Metadata Boundary FAQ:
  <https://developers.cloudflare.com/data-localization/metadata-boundary/faq/>
- OpenAI API data controls and data residency: <https://developers.openai.com/api/docs/guides/your-data>
- AWS Data Processing Addendum: <https://d1.awsstatic.com/legal/aws-gdpr/AWS_GDPR_DPA.pdf>
- Google Cloud locations: <https://cloud.google.com/about/locations>
