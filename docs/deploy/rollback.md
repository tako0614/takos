# ロールバック

rollback は、Capsule が保持している成功済みの StateVersion を基準に、新しい
reviewed Run / StateVersion / Output を作る control-plane の操作です。
Run ledger は append-only なので、巻き戻しも「過去に戻す」のではなく
新しい reviewed Run として記録されます。

## 巻き戻せるもの・巻き戻せないもの

- worker artifact や module 参照は、対象の commit / descriptor を固定して
  再 apply すれば前の状態に戻せます。
- provider の data copy や schema migration の巻き戻しは、現在の rollback の
  保証範囲ではありません。provider-gap bridge が作った D1 のデータも
  destroy では巻き戻しません。
- runtime secret は OpenTofu state の外にあるため、secret だけを戻す操作は
  `wrangler secret put` で再投入します。

## 次に読む

- [デプロイ手順](/deploy/deploy)
- [トラブルシューティング](/deploy/troubleshooting)
- [Takosumi deploy model](https://takosumi.com/docs/reference/model)
