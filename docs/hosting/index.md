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
| [Cloudflare](/hosting/cloudflare)   | reference backend                   | stable         |
| [Local](/hosting/local)             | local development                   | stable         |
| [Self-hosted](/hosting/self-hosted) | VM / Docker Compose / Helm guidance | supported      |
| [Kubernetes](/hosting/kubernetes)   | base Helm chart                     | supported      |
| [AWS](/hosting/aws)                 | EKS Helm overlay                    | overlay        |
| [GCP](/hosting/gcp)                 | GKE Helm overlay                    | overlay        |

AWS / GCP pages describe the current Helm overlays only. They are not direct ECS
/ Cloud Run deploy guides and do not define a provider resource materialization
matrix.

Self-hosted packaging can be used for production when PostgreSQL / Redis /
object storage / TLS / secret management are replaced with production-grade
backing services. ECS / Cloud Run may appear as tenant image workload adapters
through the OCI orchestrator, but they are not Takos kernel hosting surfaces.

## Backend の差分

current hosting surface の比較と current contract に含まれない項目は
[環境ごとの差異](/hosting/differences) と
[Not A Current Contract](/hosting/differences#not-a-current-contract) を参照。

## 次に読むページ

- [Kubernetes](/hosting/kubernetes) --- base Helm chart
- [AWS](/hosting/aws) --- EKS overlay
- [GCP](/hosting/gcp) --- GKE overlay
- [Cloudflare](/hosting/cloudflare) --- reference backend
