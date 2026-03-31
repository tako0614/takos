# Platform Compatibility Matrix

このページは「今 repo に tracked template があり、どこまで current contract として説明できるか」をまとめます。

Takos の public spec は Cloudflare-native です。runtime model は Takos runtime で、Cloudflare backend が基準 backend、local / self-host / AWS / GCP / k8s が互換 backend です。

## Support matrix

| surface | status | primary config | notes |
| --- | --- | --- | --- |
| Cloudflare Workers + CF Containers | `stable` | tracked Cloudflare templates | current primary deploy surface |
| Local Docker Compose | `stable` | `.env.local.example`, `compose.local.yml` | 開発・smoke 用 |
| Local-platform manual process | `supported` | self-host env template + `dev:local:*` scripts | compose を使わない manual 起動 |
| Helm / Kubernetes | `supported` | Helm chart | self-host packaging |
| Generic OCI orchestrator | `experimental` | `OCI_ORCHESTRATOR_*`, `TAKOS_LOCAL_*` | provider-aware runtime。`k8s` / `cloud-run` / `ecs` は native backend、その他は fallback backend |
| ECS / Cloud Run / k8s 直 deploy | `provider-dependent` | custom operator wiring + OCI-backed provider | repo 内 backend あり。ECS は task/service bootstrap env が必要 |

Resource layer は Cloudflare-native public kind を維持し、Cloudflare backend では直接実現され、互換 backend では `provider-backed` または Takos-managed runtime に解決されます。詳細は [環境ごとの差異](/hosting/differences) を参照。

## Tracked templates

| file | purpose |
| --- | --- |
| `.env.local.example` | compose/local stack |
| `apps/control/.env.example` | control app の baseline env template |
| `apps/control/.env.self-host.example` | manual local-platform / self-host env template |
| `apps/control/SECRETS.md` | Cloudflare / self-host secret inventory |
| `apps/control/wrangler*.toml` | Cloudflare deploy template (6 ファイル) |
| `deploy/helm/takos/` | self-host Helm chart |

## current env groups

### local / self-host

主に次を使います。

- `TAKOS_LOCAL_*`
- `OCI_ORCHESTRATOR_*`
- `DATABASE_URL` / `POSTGRES_URL`
- `REDIS_URL`
- S3-compatible / storage vars

### Cloudflare

主に次を使います。

- `ADMIN_DOMAIN`
- `TENANT_BASE_DOMAIN`
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- `PLATFORM_PRIVATE_KEY` / `PLATFORM_PUBLIC_KEY`
- `CF_ACCOUNT_ID`
- `CF_ZONE_ID`
- `WFP_DISPATCH_NAMESPACE`
- `CONTROL_RPC_BASE_URL`
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GOOGLE_API_KEY`
- `STRIPE_*`

## Runtime topology by surface

| surface | control web | dispatch | background worker | runtime host | executor host | browser host |
| --- | --- | --- | --- | --- | --- | --- |
| Cloudflare | Worker | Worker | Worker | CF Container host | CF Container host | CF Container host |
| Local Compose | containerized local-platform | containerized local-platform | containerized local-platform | local-platform | local-platform | local-platform |
| Helm / self-host | local-platform service | local-platform service | local-platform service | local-platform service | local-platform service | local-platform service |

Cloudflare は Takos runtime の基準 backend、local/Helm は互換 backend、という理解で運用するとズレにくいです。
