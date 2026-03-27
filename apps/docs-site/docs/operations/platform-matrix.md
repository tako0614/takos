# Platform Compatibility Matrix

このページは「今 repo に tracked template があり、どこまで current contract として説明できるか」をまとめます。

## Support matrix

| surface | status | primary config | notes |
| --- | --- | --- | --- |
| Cloudflare Workers + CF Containers | `stable` | tracked Cloudflare templates | current primary deploy surface |
| Local Docker Compose | `stable` | `.env.local.example`, `compose.local.yml` | 開発・smoke 用 |
| Local-platform manual process | `supported` | self-host env template + `dev:local:*` scripts | compose を使わない manual 起動 |
| Helm / Kubernetes | `supported` | Helm chart | self-host packaging |
| Generic OCI orchestrator | `experimental` | `OCI_ORCHESTRATOR_*`, `TAKOS_LOCAL_*` | provider adapter 前提 |
| ECS / Cloud Run 直 deploy | `provider-dependent` | custom operator wiring | repo 内 docs/template は first-class ではない |

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

Cloudflare は provider-native、local/Helm は local-platform contract を使う、という理解で運用するとズレにくいです。
