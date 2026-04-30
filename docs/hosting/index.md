# Hosting

このセクションは **Takos kernel をホストする operator** 向けです。Takos 上で
**group を deploy する開発者** は [Deploy](/deploy/) を参照してください。

## 想定読者

| 読者                                      | 読むページ                           |
| ----------------------------------------- | ------------------------------------ |
| Takos kernel を managed (takos.jp) で使う | このセクションは不要                 |
| Takos kernel を自分でホストする operator  | このセクション全体                   |
| Takos 上で group を作る developer         | [Deploy](/deploy/) と [Apps](/apps/) |

## Backend / Packaging

| page                                | 用途                                | current status |
| ----------------------------------- | ----------------------------------- | -------------- |
| [Cloudflare](/hosting/cloudflare)   | tracked reference Workers backend   | stable         |
| [Local](/hosting/local)             | local development                   | stable         |
| [Self-hosted](/hosting/self-hosted) | VM / Docker Compose / Helm guidance | supported      |
| [Kubernetes](/hosting/kubernetes)   | base Helm chart + k8s plugin        | supported      |
| [AWS](/hosting/aws)                 | EKS Helm overlay + AWS plugin       | overlay        |
| [GCP](/hosting/gcp)                 | GKE Helm overlay + GCP plugin       | overlay        |
| [Multi-cloud](/hosting/multi-cloud) | 4 cloud 横断 runbook                | new (Phase 17) |

AWS / GCP / Kubernetes / Self-hosted の各ページは **2 つの path** を扱います:

1. **kernel hosting** (Helm chart / Docker Compose で control plane を動かす)
2. **provider plugin** (Cloudflare control plane を維持しつつ tenant runtime
   / resource を別 cloud に置く path、Phase 17 で追加)

multi-cloud / hybrid 構成 (例: Cloudflare control + AWS tenant runtime,
Cloudflare control + GCP tenant DB) は [Multi-cloud](/hosting/multi-cloud)
を参照してください。

Self-hosted packaging can be used for production when PostgreSQL / Redis /
object storage / TLS / secret management are replaced with production-grade
backing services. ECS / Cloud Run may appear as tenant image workload adapters
through the OCI orchestrator, but they are not Takos kernel hosting surfaces.

## Backend の差分

current hosting surface の比較と current contract に含まれない項目は
[環境ごとの差異](/hosting/differences) と
[Not A Current Contract](/hosting/differences#not-a-current-contract) を参照。

## 多クラウド対応のクイック参照

| 構成                                            | profile                              | 主な provider plugin                    |
| ----------------------------------------------- | ------------------------------------ | --------------------------------------- |
| Cloudflare のみ                                 | `cloudflare.example.json`            | Cloudflare 6 provider                   |
| Cloudflare control + AWS tenant runtime         | `cloudflare-aws.example.json`        | AWS 6 provider + CF dispatch            |
| Cloudflare control + GCP tenant runtime         | `cloudflare-gcp.example.json`        | GCP 6 provider + CF dispatch            |
| Cloudflare control + k8s tenant runtime         | `cloudflare-kubernetes.example.json` | k8s provider + CF dispatch              |
| AWS のみ                                        | `aws.example.json`                   | AWS 6 provider + ALB routing            |
| GCP のみ                                        | `gcp.example.json`                   | GCP 6 provider + LB routing             |
| Selfhosted (bare metal / Docker)                | `selfhosted.example.json`            | local container provider + Caddy        |

profile 選択ガイドと credential injection の topology は
[Multi-cloud](/hosting/multi-cloud#profile-の選び方) を参照してください。

## 次に読むページ

- [Cloudflare](/hosting/cloudflare) --- tracked reference Workers backend
- [Multi-cloud](/hosting/multi-cloud) --- 4 cloud 横断 runbook
- [Kubernetes](/hosting/kubernetes) --- base Helm chart + k8s plugin
- [AWS](/hosting/aws) --- EKS overlay + AWS plugin
- [GCP](/hosting/gcp) --- GKE overlay + GCP plugin
- [Self-hosted](/hosting/self-hosted) --- bare metal + selfhosted plugin
