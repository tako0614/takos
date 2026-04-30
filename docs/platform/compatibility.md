# Platform Compatibility Matrix

このページは「今 repo に tracked template があり、どこまで current contract
として説明できるか」をまとめます。

Takos の public spec は backend-neutral です。runtime model は tenant runtime
です。Cloudflare は tracked reference Workers backend ですが、PaaS Core の canonical
provider ではありません。local / self-host / k8s は同じ manifest schema と
translation surface を共有します。AWS / GCP は current docs では Helm overlay
のみです。backend / adapter の選択は operator-only configuration と PaaS plugin
config であり、deploy manifest には書きません。

## Support matrix

| surface                                | status      | primary config                                                                                         | notes                                                                              |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Cloudflare Workers + container adapter | `stable`    | tracked reference Workers backend templates                                                            | current primary deploy surface                                                     |
| Local Docker Compose                   | `stable`    | `.env.local.example`, `compose.local.yml`                                                              | local backend / 開発・smoke 用                                                     |
| takos-private server stack             | `supported` | `takos-private/.env.server.example`, `takos-private/compose.server.yml`, `agent/Dockerfile`           | local backend の private composition                                               |
| Local-platform manual process          | `supported` | `takos/app/apps/control/.env.self-host.example` / `takos/app/apps/control/.env.self-host` + `dev:local:*` scripts | local backend の manual 起動                                                       |
| Helm / Kubernetes self-host packaging  | `supported` | Helm chart                                                                                             | k8s backend packaging                                                              |
| Generic OCI orchestrator               | `supported` | `OCI_ORCHESTRATOR_*`, `TAKOS_LOCAL_*`                                                                  | tenant image workload adapter integration                                          |
| ECS / Cloud Run / k8s image adapters   | `supported` | custom operator wiring + OCI-backed backend integration                                                | tenant image workload adapters。ECS / Cloud Run は kernel hosting surface ではない |

Resource layer は backend-neutral public kind を維持し、各 backend では
backend-specific backing service または Takos-managed runtime
に解決されます。compatible は schema / translation parity であり、resource
existence や behavior parity ではありません。詳細は
[環境ごとの差異](/hosting/differences) と
[Not A Current Contract](/hosting/differences#not-a-current-contract) を参照。

## Tracked templates

| file                                  | purpose                                        |
| ------------------------------------- | ---------------------------------------------- |
| `.env.local.example`                  | compose/local stack                            |
| `takos/app/apps/control/.env.example`           | control service の baseline env template       |
| `takos/app/apps/control/.env.self-host.example` | control local-platform manual process template |
| `takos-private/.env.server.example`             | takos-private server stack template            |
| `takos-private/compose.server.yml`              | takos-private server compose                   |
| `agent/Dockerfile`                              | Rust executor container                        |
| `takos-private/apps/executor`                   | legacy TypeScript executor fallback            |
| `takos/app/apps/control/SECRETS.md`             | Cloudflare / self-host secret inventory        |
| `takos/app/apps/control/wrangler*.toml`         | tracked reference Workers backend deploy template |
| `takos/app/apps/control/.secrets/<env>`         | tracked reference Workers backend runtime secret 管理元 |
| `takos/paas/deploy/helm/takos/`                      | self-host Helm chart                           |

## current env groups

### local / k8s

主に次を使います。

- OSS local stack: `.env.local.example` / `.env.local`
- local-platform manual process: `takos/app/apps/control/.env.self-host.example` /
  `takos/app/apps/control/.env.self-host`
- takos-private server stack: `takos-private/.env.server.example` /
  `takos-private/compose.server.yml`
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

| surface    | control web                  | dispatch                     | background worker            | runtime host           | executor host          |
| ---------- | ---------------------------- | ---------------------------- | ---------------------------- | ---------------------- | ---------------------- |
| cloudflare | Worker                       | Worker                       | Worker                       | CF Container host      | CF Container host      |
| local      | containerized local-platform | containerized local-platform | containerized local-platform | local-platform         | local-platform         |
| k8s        | local-platform service       | local-platform service       | local-platform service       | local-platform service | local-platform service |

cloudflare を tracked reference Workers backend とし、local/self-host/k8s は同じ
manifest schema / translation surface を実装する supported surfaces として
運用します。AWS / GCP は Helm overlay の範囲だけを current contract とします。
