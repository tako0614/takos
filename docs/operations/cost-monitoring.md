# Operations: Cost Monitoring and AppInstallation Attribution

> このページでわかること: Takos operated environments の cloud spend を
> AppInstallation / Space 単位で追跡する dashboard、metric contract、
> reconciliation cadence。canonical hierarchy は Takosumi Account → Space →
> AppInstallation で、billing / cost は AppInstallation-scoped です。

この runbook は Takos managed installation GA readiness (Phase 1.x in ROADMAP.md
Part II) の cost monitoring 正本です。Takos の primary customer surface は
Web/API であり、Takos CLI を独立した customer capacity / cost surface
として扱いません。`takosumi` / `takosumi-git` CLI から発生する deploy traffic
は、最終的に Takos Web/API または Takosumi API の Space-scoped usage
として集計します。

Dashboard artifact:

- `deploy/observability/grafana/takos-cost-attribution.json`

## Scope

**Cost attribution hierarchy** (canonical):

- **Takosumi Account** (legal billing party): invoice payer
- **Space** (Account 配下、personal / team / org): organization unit
- **AppInstallation** (Space 配下、各 app 1 instance): primary cost attribution
  unit

billing line item は AppInstallation 単位で計上、Space で集計、Takosumi Account
の invoice に統合されます。

対象は Takos-operated production / staging environments の AppInstallation /
Space-attributed cost です。

| Surface                       | Owner                   | Cost source                                        |
| ----------------------------- | ----------------------- | -------------------------------------------------- |
| `takos-app` Web/API metering  | Takos product           | app-local `app_usage_events` / `app_usage_rollups` |
| Takos billing reconciliation  | Takosumi Accounts/Cloud | private billing ledger + app usage rollup join     |
| `takos-git` Smart HTTP        | Takos product           | request / storage / transfer exporter              |
| `takos-agent` execution       | Takos product           | `exec_seconds`, queue, model/tool meters           |
| Takosumi deploy lifecycle     | Takosumi kernel signals | Space-scoped usage + provider bill join            |
| Default apps                  | owning app repo         | route / storage / runtime usage exporter           |
| Cloud provider infrastructure | operator distribution   | AWS / GCP / Cloudflare billing export              |

Invoices, payment processor reconciliation, and secret-bearing cloud billing
credentials stay in `takos-private/`. This public doc defines the observable
metric contract and the dashboard artifact only.

## Metric Contract

The dashboard expects Prometheus-compatible counters produced by the managed
billing, app-usage, and cloud-cost ETL. Counters are cumulative; cost metrics
are stored in cents and usage metrics keep their native units.

| Metric                                 | Required labels                              | Source                                                         |
| -------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- |
| `takos_cloud_spend_cents_total`        | `space_id`, `provider`, `service`, `region`  | cloud provider bill export joined to Space attribution         |
| `takos_billing_usage_cost_cents_total` | `space_id`, `account_id`, `meter_type`       | Takosumi Accounts/Cloud billing ledger reconciliation          |
| `takos_app_usage_units_total`          | `space_id`, `owner_account_id`, `meter_type` | Takos app `app_usage_events.units` / `app_usage_rollups.units` |

Optional attribution labels:

- `cost_center`
- `project_code`
- `customer_segment`
- `plan_id`

`space_id` is mandatory for attributed spend. Cloud bill rows that cannot be
joined to a Space must be exported with `space_id=""` so the dashboard can show
unattributed spend explicitly.

## Attribution Join

Cost attribution uses this order:

1. Direct resource tag: `space_id`, `takos_space_id`, or provider-specific
   equivalent on the cloud resource.
2. Takosumi Space attribution labels: `takosumi_cost_center`,
   `takosumi_project_code`, `takosumi_customer_segment`.
3. Takos app `owner_account_id` / Space usage mapping.
4. Fallback to `space_id=""` with provider, service, region, and invoice line
   metadata preserved in the private billing pipeline.

The kernel-side metadata contract is defined in
`takosumi/docs/reference/cost-attribution.md`. The Takos dashboard consumes the
joined metric output and does not mutate kernel attribution state.

## Dashboard Panels

`takos-cost-attribution.json` includes:

- Cloud spend for the last 30 days.
- Billed usage for the last 30 days.
- Gross margin for attributed usage.
- Attribution coverage for the last 24 hours.
- Top AppInstallations by cloud spend.
- Cloud spend by provider and service.
- Top AppInstallations by billed usage.
- Billed usage by meter.
- Cloud spend by cost center / project code.
- Unattributed cloud spend for the last 24 hours.

The dashboard uses `DS_PROMETHEUS`, `space_id`, and `provider` variables. It
must be provisioned in the same folder as the deploy overview dashboard so
on-call can pivot from SLO impact to cost impact during an incident.

## Reconciliation

Daily:

- Check attribution coverage. Unattributed spend must stay below 2% of daily
  cloud spend.
- Review top 20 AppInstallations by cloud spend and billed usage.
- Confirm there are fresh samples for both cloud spend and billing usage.

Monthly close:

- Compare `sum(increase(takos_cloud_spend_cents_total[30d]))` with provider
  invoice totals in `takos-private/`.
- Compare `sum(increase(takos_app_usage_units_total[30d]))` with Takos app
  `app_usage_rollups.units` for the same period, then compare priced billing
  output against the Takosumi Accounts/Cloud ledger.
- Record the reconciliation result in the private finance / operations log.
- File a follow-up if provider invoice delta exceeds 1% or billing usage delta
  exceeds 0.5%.

## Alerts

| Alert                       | Condition                                             | Action                                          |
| --------------------------- | ----------------------------------------------------- | ----------------------------------------------- |
| Cost exporter missing       | no samples for 30 minutes                             | page primary during business hours, SEV-3       |
| Unattributed spend high     | `space_id=""` spend > 2% for 24h                      | block GA promotion until attribution is fixed   |
| AppInstallation spend spike | AppInstallation spend > 3x its 30-day p95 daily spend | inspect abuse, quota, or noisy workload         |
| Negative margin             | gross margin < 0 for 24h on paid plans                | inspect pricing / provider cost / meter mapping |
| Provider bill drift         | monthly cloud invoice delta > 1%                      | finance + operator reconciliation review        |

## Privacy and Access

Dashboards must use opaque `space_id`, `owner_account_id`, and Account labels.
Do not export customer email, company name, payment processor customer id,
invoice id, or support ticket id as metric labels. Private billing systems may
resolve IDs to customer records, but Grafana dashboards stay operator-facing and
identifier-only.

## Validation

Run:

```bash
cd takos
deno task validate:observability
```

The validator parses Grafana JSON dashboards and checks that the cost
attribution dashboard remains linked from this runbook.
