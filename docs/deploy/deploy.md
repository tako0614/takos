# Takos のデプロイライフサイクル

Takos は provider 中立のリソース契約を `deploy/product-resources.json` に持ち、
`deploy/opentofu/cloudflare` が現在の product-graph adapter です。Cloudflare の
provider 差分は、使い捨ての E2E で reviewed な bridge を選ぶまでは明示的なままです。
Takosumi はこれを普通の OpenTofu module として実行し、**Capsule** と
**`plan` Run → `apply` Run → StateVersion / Output** の記録を残します。

## 流れ

1. 直接接続した Cloudflare アカウントで `deploy/opentofu/cloudflare` を選びます。
   旧 Provider 1.x の Takoform projection は現在の install 経路ではありません。
2. Git URL / ref から Takos の Capsule を登録・更新し、記録された `plan` Run を
   apply 前に確認します。
3. `apply` が StateVersion と Output を記録し、policy / 監査の証跡を残します。
4. adapter が product 所有の runtime 接続と変更不可の artifact を用意します。

## Cloudflare provider-gap bridge

直接の Cloudflare adapter は product graph を宣言しますが、provider-gap bridge は
既定で無効です。通常の production apply が未対応の差分を暗黙に埋めることは
ありません。使い捨ての staging smoke では `environment = "staging"` と
`cloudflare_provider_gap_bridge_mode = "staging"` を、使い捨ての production E2E
では `environment = "production"` と `"disposable-production"` に加えて
`cloudflare_provider_gap_bridge_acknowledgement = "DISPOSABLE_PRODUCTION_ONE_SHOT"`
を設定します。それ以外の acknowledgement は安全側に失敗します。

bridge はアプリ所有で、対象は Vectorize、container 対応の Durable Object
migration、Container application の調整だけです。D1 の schema はその対象外です。
Worker が組み込みの migration set を runtime に適用するため、apply 時に
データベースを migrate する段階はありません。destroy は bridge が作った
Container application と Vectorize index を所有権を確認してクリーンアップします。
bridge が D1 を読み書きすることはありません。

## install の形

```json
{
  "spaceId": "space_1",
  "module": {
    "kind": "git",
    "url": "https://github.com/example/app.git",
    "ref": "main"
  }
}
```

plan / apply の要求は Capsule に対する typed Run として記録されます。Takos と
Takosumi の分担は [Takos の概念](/platform/)を参照してください。

## 関連ページ

- [Deploy overview](/deploy/)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi API](https://takosumi.com/docs/reference/api)
