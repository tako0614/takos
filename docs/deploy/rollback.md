# ロールバック

> このページでわかること: デプロイをロールバックする手順と注意点。

## `takos rollback`

```bash
takos rollback my-app --space SPACE_ID
```

`takos rollback GROUP_NAME --space SPACE_ID` は group の前回成功 snapshot を再適用する操作です。
引数は group 名（`.takos/app.yml` の `name` または `--group` で指定したもの）。

snapshot に保存された execution context も戻すため、provider と env も rollback
対象です。branch の移動や tag の付け替えには影響されません。

対象 group の row が既に削除されている場合、rollback は失敗します。 rollback
が削除済み group を再生成することはありません。

## rollback で戻るもの

- compute コード (worker bundle / container image)
- compute env vars
- consumed publication outputs
- routes
- publication declarations
- provider / execution context

## rollback で戻らないもの

- DB data (forward-only migration)
- object-store / key-value のデータ
- secret values (auto-generated は再生成しない)
- group 削除時の resource (uninstall は terminal)

## rollback は snapshot 再適用のみ

Takos における **rollback は group snapshot の再適用だけ** です。
`takos rollback GROUP_NAME --space SPACE_ID` で前回成功した group snapshot を再適用します。 個別
Worker / Container を選んで戻す操作はありません。

git checkout して再 deploy するのは「コードを編集して再 deploy する」通常の
deploy フローであり、rollback ではありません。コード自体を以前の version
に戻したい場合は 通常通り `takos deploy --space SPACE_ID` を実行してください（rollback API
は経由しません）。

repo URL から `takos deploy --space SPACE_ID` した group / `takos install OWNER/REPO --space SPACE_ID` した group / ローカル
deploy した group のいずれも、`takos rollback GROUP_NAME --space SPACE_ID` で前回 snapshot を
再適用できます。

## digest pin の扱い

`compute.<name>` の image-backed workload は digest pin された `image` (64-hex
`sha256` digest) だけが rollback 対象になります。mutable tag は current contract
では deploy 自体を拒否します。

## uninstall との関係

`takos uninstall` は group を terminal に削除する操作です。managed resources を
drain したあと group row も削除するため、あとから `takos rollback ...` を
実行しても deleted group は復元されません。

## 複数 Worker / Container を含む group の rollback

`takos deploy` で複数の Worker / Container を含む group を deploy している場合、
`takos rollback GROUP_NAME --space SPACE_ID` は **group 全体の前回 snapshot を一括で再適用**
します。個別 Worker や個別 Container だけを rollback することはできません。

```bash
takos rollback my-app --space SPACE_ID
```

snapshot は group 単位で immutable に保存されているため、内訳の Worker /
Container は snapshot に含まれている version でまとめて元に戻ります。`depends`
の順序解決 や Container と Worker の対応関係は snapshot 再適用時に kernel
側で行われるため、 ユーザーが手動で順番を意識する必要はありません。

### DB スキーマ・データは自動ロールバックされない

::: danger sql / object-store / key-value への書き込みはロールバックされません。
:::

ロールバックで戻るのは Worker のコードと設定だけです。以下は手動対応が必要です:

- **sql**: スキーマ変更（ALTER TABLE など）を手動で巻き戻す（migration は
  forward-only）
- **object-store**: 書き込まれたオブジェクトの削除・復元
- **key-value**: 書き込まれたキーの削除・復元
- **外部サービス**: Webhook 登録や外部 API の状態変更

DB
マイグレーションは常に後方互換にしておくと、ロールバック時のリスクを減らせます。

## ロールバックのベストプラクティス

1. **デプロイ前に manifest を検証する**: `takos deploy --plan --space SPACE_ID` で non-mutating
   preview を確認
2. **DB マイグレーションは後方互換に**:
   ロールバック時に旧コードが動くよう、カラム追加は nullable にする
3. **rollback は group 単位の一括操作**: `takos rollback GROUP_NAME --space SPACE_ID` は group の
   snapshot をまるごと再適用する。個別 Worker / Container を選んで rollback
   すること はできない
4. **rollback と redeploy を混同しない**: 「以前のコードに戻したい」だけなら git
   の履歴を遡って通常の `takos deploy --space SPACE_ID` を実行する。`takos rollback` は snapshot
   再適用のための専用 API

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由のデプロイ
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
