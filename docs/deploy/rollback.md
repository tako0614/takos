# ロールバック

> このページでわかること: デプロイをロールバックする手順と注意点。

## `takos rollback`

```bash
takos rollback my-app --space SPACE_ID
```

`takos rollback GROUP_NAME --space SPACE_ID` は group の前回成功 deployment
record へ戻す操作です。引数は deploy / install 時に `--group` で指定した group
名です。

repository / catalog 由来の deploy は、install 時に app bundle を永続化しません。
Takos は repository URL / ref / 解決済み commit / manifest / build metadata
を source cache として保存し、rollback では記録済み commit を再解決して既存 group
へ再 deploy します。branch の移動や tag の付け替えには影響されません。

local manifest 由来など、再取得できる repository source がない deploy
では保存済み manifest / artifacts を使います。`compute.<name>.consume`
は記録された宣言に戻りますが、consumed publication outputs は rollback
実行時の catalog から再解決されます。

対象 group の row が既に削除されている場合、rollback は失敗します。rollback
が削除済み group を再生成することはありません。

## rollback で戻るもの

- compute コード (worker bundle / container image)
- compute env vars
- routes
- publication declarations
- consume declarations
- source metadata / artifacts / runtime env

## rollback で戻らないもの

- DB data (forward-only migration)
- object-store / key-value のデータ
- secret values (auto-generated は再生成しない)
- consumed publication output values (rollback 実行時に再解決)
- group 削除時の resource (uninstall は terminal)

## rollback は group 単位の操作

Takos における **rollback は group の前回成功 deployment record
へ戻す操作だけ** です。個別 Worker / Service / Attached Container
を選んで戻す操作はありません。

git checkout して再 deploy するのは「コードを編集して再 deploy する」通常の
deploy フローです。rollback API を経由せずに別の commit / branch を反映したい
場合は、通常通り `takos deploy --space SPACE_ID --group GROUP_NAME`
を実行してください。

repo URL から `takos deploy --space SPACE_ID --group GROUP_NAME` した group /
`takos install OWNER/REPO --space SPACE_ID --group GROUP_NAME` した group /
ローカル deploy した group
のいずれも、`takos rollback GROUP_NAME --space SPACE_ID` で前回成功 record
へ戻せます。

## digest pin の扱い

`compute.<name>` の image-backed workload は digest pin された `image` (64-hex
`sha256` digest) だけが rollback 対象になります。mutable tag は current contract
では deploy 自体を拒否します。

## uninstall との関係

`takos uninstall` は group を terminal に削除する操作です。manifest-managed
workload / route / publication を drain したあと group row も削除するため、
あとから `takos rollback ...` を実行しても deleted group は復元されません。

## 複数 Worker / Service / Attached Container を含む group の rollback

`takos deploy` で複数の Worker / Service / Attached Container を含む group を
deploy している場合、`takos rollback GROUP_NAME --space SPACE_ID` は **group
全体を前回成功 deployment record へ戻します**。個別 Worker / Service / Attached
Container だけを rollback することはできません。

```bash
takos rollback my-app --space SPACE_ID
```

source cache / stored artifact は group 単位で記録されているため、内訳の Worker
/ Service / Attached Container は同じ record に含まれる version でまとめて元に戻ります。
`depends` の順序解決、Attached Container と Worker の対応関係、consume output
の再解決は rollback 時に kernel 側で行われるため、ユーザーが手動で順番を
意識する必要はありません。

### DB スキーマ・データは自動ロールバックされない

::: danger sql / object-store / key-value への書き込みはロールバックされません。
:::

ロールバックで戻るのは Worker のコードと設定だけです。以下は手動対応が必要です:

- **sql**: スキーマ変更（ALTER TABLE など）を手動で巻き戻す（migration は
  forward-only）
- **object-store**: 書き込まれたオブジェクトの削除・復元
- **key-value**: 書き込まれたキーの削除・復元
- **外部サービス**: Webhook 登録や外部 API の状態変更

DB マイグレーションは expand-only
にしておくと、ロールバック時のリスクを減らせます。

## ロールバックのベストプラクティス

1. **デプロイ前に manifest を検証する**:
   `takos deploy --plan --space SPACE_ID --group GROUP_NAME` で non-mutating
   preview を確認
2. **DB マイグレーションは expand-only に**: カラム追加は nullable
   にし、破壊的変更は段階的に反映する
3. **rollback は group 単位の一括操作**:
   `takos rollback GROUP_NAME --space SPACE_ID` は group の前回成功 record
   へ戻す。個別 Worker / Service / Attached Container を選んで
   rollback することはできない
4. **rollback と redeploy を混同しない**: 「以前のコードに戻したい」だけなら git
   の履歴を遡って通常の `takos deploy --space SPACE_ID --group GROUP_NAME`
   を実行する。`takos rollback` は前回成功 record へ戻すための専用 API

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由のデプロイ
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
