# Dispatch Namespace

> このページでわかること: tracked reference Workers backend が使う dispatch
> namespace の位置づけと、group との関係。

dispatch namespace は tracked reference Workers backend で tenant worker
を論理分離するための backend detail。Takos の public spec では manifest
に書く対象ではなく、operator が Cloudflare 側で準備する実行基盤の一部として扱う。

## 何に使うか

tracked reference Workers backend では worker workload が dispatch namespace
配下に載る。これにより、tenant worker を control plane や他 tenant
から論理分離できる。

## public CLI との関係

public CLI の `takos deploy` / `takos install` には `--namespace` option
はない。

- deploy manifest author は `.takos/app.yml` と `--group` を意識する
- operator は Cloudflare 側で dispatch namespace を作成し、control-plane
  環境変数に接続する

Cloudflare 用の実運用では `WFP_DISPATCH_NAMESPACE` などの operator 設定が
namespace 解決を担う。private control plane の current config では production
namespace が `takos-tenants`、staging namespace が `takos-staging-tenants`
です。

## group との関係

group は Deployment record を順序付ける state scope、dispatch namespace は
backend 側の worker 隔離単位。

- group: inventory / GroupHead / source / reconcile status を持つ state scope
- dispatch namespace: tracked reference Workers backend 上の worker 配置先

group 名は inventory や Deployment 履歴 (GroupHead 経由) の識別に使われるが、
namespace 指定自体は public CLI surface ではない。

## operator の準備

tracked reference Workers backend では namespace 自体を先に作る。

```bash
wrangler dispatch-namespace create takos-tenants
wrangler dispatch-namespace create takos-staging-tenants
```

その後、operator 設定から Takos control plane に接続する。

## 注意点

- namespace の作成は Cloudflare ダッシュボードまたは API で事前に行う
- namespace は backend detail なので、manifest の portability を壊さないよう
  deploy spec には露出しない
- local / self-host / AWS / GCP / k8s では Cloudflare dispatch namespace
  をそのまま再現しない

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由のデプロイ
- [Cloudflare](/hosting/cloudflare) --- operator 向け Cloudflare 設定
