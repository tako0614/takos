# 実行履歴（Run History）

Takosumi は Capsule ごとの操作を typed Run の ledger として記録します。
履歴は追記専用で、plan・apply・destroy のそれぞれが StateVersion / Output と
policy / audit evidence を伴います。

## ledger に記録されるもの

- **Capsule** — Git URL / ref / module path で特定される install 単位
- **`plan` type Run** — 変更内容・警告・policy 判定を含む reviewed plan
- **`apply` type Run** — 承認された plan の適用。成功時に StateVersion と
  Output を更新する
- **`destroy_plan` / `destroy_apply`** — destroy も同じく 2 段階で記録し、
  取り壊しを Capsule の現在の StateVersion / Output evidence に紐付ける
- **StateVersion / Output** — 成功した apply が残す state の版と公開値
- **policy / audit evidence** — 誰が、いつ、どの policy で実行したか

workspace や capsule の履歴を追うときは、この ledger を起点にします。

## 次に読む

- [デプロイ手順](/deploy/deploy)
- [ロールバック](/deploy/rollback)
- [実行場所](/deploy/namespaces)
