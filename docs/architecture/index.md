# アーキテクチャ

Takos には 2 つの読み方があります。

- public product model
- internal runtime model

## Public Product Model

現在の Takos の product boundary は次の 3 つです。

- kernel
- workspace shell
- installable apps

`Store`、`Repos`、`Chat`、`Agent` は Takos 本体ではなく、Takos 上で動く app
として扱います。canonical URL は app 側が持ち、Takos UI は shell launch URL
からそれらを起動します。詳細は
[Kernel / Workspace Shell / Apps](./kernel-shell.md) を参照してください。

## Internal Runtime Model

実装を追うときは、引き続き次の 2 面で読むのが有効です。

- control plane
- tenant runtime

### Control Plane

control plane は次を担います。

- API
- deploy / rollback / routing
- resource / binding 管理
- kernel / shell を支える管理面

### Tenant Runtime

tenant runtime は deploy された artifact が実際に request を処理する面です。

## local と Cloudflare

Takos は control plane について `Cloudflare | local` の adapter
差し替えを目指しています。\
一方で tenant runtime は Workers-compatible な contract を維持する方針です。

現時点の canonical 方針は次です。

- local control plane: Node-backed
- tenant runtime: Workers-compatible
- Cloudflare: provider / runtime backend の 1 つ

## public model と internal model

public surface では `.takos/app.yml`、workspace shell、installable apps
が見えます。\
internal では `service / route / deployment` のモデルに寄せています。

この分離により:

- public contract は app builder と operator にわかりやすい
- internal では routing / rollback / provider 差分を扱いやすい

## provider と adapter

- adapter: local / Cloudflare の control plane 差分
- provider: cloudflare / oci の deploy backend 差分

Takos ではこの 2 軸を分けることで、Cloudflare 依存を platform
全体へ広げないようにしています。

## 詳細ページ

- [Kernel / Workspace Shell / Apps](./kernel-shell.md) — Takos の current
  product contract
- [Control Plane](./control-plane.md) — API, Cron, DB, provider abstraction
- [Agent Runtime](./agent-runtime.md) — Rust container を正本にする agent
  実行境界
- [Tenant Runtime](./tenant-runtime.md) — WFP dispatch, health wrapper, traffic
  split
- [互換性と制限](./compatibility.md) — Workers と local
  の一致点、意図的な差分、既知の制限
- [Resource Governance](/platform/resource-governance) — Plan, quota, metering,
  billing
- [課金](/platform/billing) — Billing account, plan, transaction, usage の詳細
