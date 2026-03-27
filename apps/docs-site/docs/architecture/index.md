# アーキテクチャ

## 2 つの面

Takos は大きく次の 2 面に分かれます。

- control plane
- tenant runtime

### control plane

control plane は次を担います。

- API
- deploy / rollback / routing
- run lifecycle
- resource / binding 管理

### tenant runtime

tenant runtime は deploy された artifact が実際にリクエストを処理する面です。

## local と Cloudflare

Takos は control plane について `Cloudflare | local` の adapter 差し替えを目指しています。  
一方で tenant runtime は Workers-compatible な contract を維持する方針です。

現時点の canonical 方針は次です。

- local control plane: Node-backed
- tenant runtime: Workers-compatible
- Cloudflare: provider / runtime backend の 1 つ

## public model と internal model

public surface では `/workers` が見えます。  
internal では `service / route / deployment` のモデルに寄せています。

この分離により:

- public UX はわかりやすい
- internal では routing / rollback / provider 差分を扱いやすい

## provider と adapter

- adapter: local / Cloudflare の control plane 差分
- provider: cloudflare / oci の deploy backend 差分

Takos ではこの 2 軸を分けることで、Cloudflare 依存を platform 全体へ広げないようにしています。

## 詳細ページ

- [Control Plane](./control-plane.md) — API, Cron, DB, provider abstraction
- [Tenant Runtime](./tenant-runtime.md) — WFP dispatch, health wrapper, traffic split
- [互換性と制限](./compatibility-and-limitations.md) — Workers と local の一致点、意図的な差分、既知の制限
- [Resource Governance](./resource-governance.md) — Plan, quota, metering, billing
- [Billing](./billing.md) — Billing account, plan, transaction, usage の詳細
