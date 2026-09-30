# デプロイ手順

Takos は provider-neutral な resource contract を `deploy/product-resources.json` に持ち、
`deploy/opentofu/cloudflare` が現在の product-graph adapter です。Takosumi がこの
普通の OpenTofu module を実行し、**Capsule** と **`plan` type Run** →
**`apply` type Run** → **StateVersion / Output** の ledger を記録します。

## 手順

1. 直接接続した Cloudflare アカウントで `deploy/opentofu/cloudflare` を選ぶ。
   旧 Provider 1.x の Takoform projection は現在の install 先ではありません。
2. Git URL / ref から Takos Capsule を登録・更新し、記録された `plan` type Run を
   apply 前に確認する。
3. `apply` が StateVersion と Output、policy / audit evidence を記録する。
4. adapter が product 所有の runtime connection と immutable artifact を materialize する。

## Cloudflare provider-gap bridge

direct Cloudflare adapter は product graph を宣言しますが、provider-gap bridge は
既定で無効です。通常の production apply は未対応の gap を暗黙に埋めません。

- disposable staging の smoke だけ、`environment = "staging"` と
  `cloudflare_provider_gap_bridge_mode = "staging"` を選べます。
- disposable production E2E は `environment = "production"` と
  `"disposable-production"`、さらに
  `cloudflare_provider_gap_bridge_acknowledgement = "DISPOSABLE_PRODUCTION_ONE_SHOT"`
  が必要です。それ以外の acknowledgement は失敗で閉じます。

bridge は app 所有で、Vectorize・D1 migration・container 付き Durable Object
migration・Container application の reconcile だけをカバーします。destroy は
bridge が作った Container application と Vectorize index を所有権を確認して掃除しますが、
D1 のデータは巻き戻しません。

## 次に読む

- [セルフホスト概要](/deploy/)
- [環境と変数](/deploy/environment)
- [ロールバック](/deploy/rollback)
- [Takosumi deploy control API](https://takosumi.com/docs/reference/deploy-control-api)
