# Dispatch Namespace

> このページでわかること: Cloudflare backend が使う dispatch namespace
> の位置づけと、group との関係。

dispatch namespace は Cloudflare backend で tenant worker を論理分離するための
backend detail。Takos の current public spec では manifest に書く対象ではなく、
operator が Cloudflare 側で準備する実行基盤の一部として扱う。

## 何に使うか

Cloudflare backend では worker workload が dispatch namespace 配下に載る。
これにより、tenant worker を control plane や他 tenant から論理分離できる。

## current public CLI との関係

current public CLI の `takos deploy` / `takos install`
には `--namespace` option はない。

- app 開発者は `.takos/app.yml` と `--group` を意識する
- operator は Cloudflare 側で dispatch namespace を作成し、
  control-plane 環境変数に接続する

Cloudflare 用の実運用では `WFP_DISPATCH_NAMESPACE`
などの operator 設定が namespace 解決を担う。

## group との関係

group は public な deploy 単位、dispatch namespace は backend 側の worker
隔離単位。

- group: desired state / observed state / inventory を束ねる
- dispatch namespace: Cloudflare backend 上の worker 配置先

group 名は deploy identity に使われるが、namespace 指定自体は public CLI
surface ではない。

## operator の準備

Cloudflare backend では namespace 自体を先に作る。

```bash
wrangler dispatch-namespace create takos-staging-tenants
wrangler dispatch-namespace create takos-production-tenants
```

その後、operator 設定から Takos control plane に接続する。

## 注意点

- namespace の作成は Cloudflare ダッシュボードまたは API で事前に行う
- namespace は backend detail なので、manifest の portability
  を壊さないよう app spec には露出しない
- local / self-host / AWS / GCP / k8s では Cloudflare dispatch namespace
  をそのまま再現しない

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由のデプロイ
- [Cloudflare](/hosting/cloudflare) --- operator 向け Cloudflare 設定
