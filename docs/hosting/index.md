# Hosting

このセクションは **Takos kernel をホストする operator** 向けです。Takos 上で **app を deploy する開発者** は [Deploy](/deploy/) を参照してください。

## 想定読者

| 読者 | 読むページ |
|---|---|
| Takos kernel を managed (takos.jp) で使う | このセクションは不要 |
| Takos kernel を自分でホストする operator | このセクション全体 |
| Takos 上で app を作る developer | [Deploy](/deploy/) と [Apps](/apps/) |

## Provider の選び方

| provider | 用途 | status |
|---|---|---|
| [Cloudflare](/hosting/cloudflare) | 主要 production backend (リファレンス実装) | stable |
| [Local](/hosting/local) | 検証 / 開発用 | stable |
| [Self-hosted](/hosting/self-hosted) | k8s / VM / docker compose | stable |
| [AWS](/hosting/aws) | ECS / EKS via compatibility adapter | experimental |
| [GCP](/hosting/gcp) | Cloud Run / GKE via compatibility adapter | experimental |
| [Kubernetes](/hosting/kubernetes) | k8s direct deploy | experimental |

## Backend の差分

各 provider の機能差は [Compatibility matrix](/hosting/differences) を参照。

## 次に読むページ

- [環境ごとの差異](/hosting/differences) — backend 比較
- [Cloudflare](/hosting/cloudflare) — リファレンス実装
- [Local](/hosting/local) — 開発用 setup
