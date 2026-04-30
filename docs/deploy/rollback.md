# ロールバック

> このページでわかること: Deployment を rollback する手順と注意点。

> 現行実装の split status は [Current Implementation Note](/takos-paas/current-state#deploy-shell) を参照

## `takos rollback`

```bash
takos rollback my-app --space SPACE_ID
```

canonical PaaS implementation の `takos rollback GROUP_NAME --space SPACE_ID` は
**group の GroupHead を previous Deployment に切り替える pointer move** です。
新しい Deployment record は作成されず、`current_deployment_id` を retained
deployment に書き戻し、`previous_deployment_id` を直前の current に置き換える
だけです。引数は deploy / install 時に `--group` で指定した group 名です。

内部的には `POST /api/public/v1/groups/:group_id/rollback` が呼ばれ、target
Deployment は GroupHead.previous_deployment_id (default) または `--target-id`
で渡された retained Deployment id です。

repository / catalog 由来の Deployment は、apply 時に app bundle を永続化しません。
Takos は repository URL / ref / 解決済み commit / manifest_snapshot / build
metadata を Deployment.input.source に保存しているため、rollback では target
Deployment.input から記録済み commit を再解決して既存 GroupHead を切り替えます。
branch の移動や tag の付け替えには影響されません。

local manifest 由来など、再取得できる repository source がない Deployment
では Deployment.input.manifest_snapshot と retained artifacts を使います。
`compute.<name>.consume` は target Deployment の Deployment.desired.bindings
に戻りますが、consumed publication outputs は rollback 後の serving で再解決
されます。

対象 group の row が既に削除されている場合、rollback は失敗します。rollback
が削除済み group を再生成することはありません。

## rollback で戻るもの

- compute コード (worker bundle / container image; Deployment.input.manifest_snapshot
  と Deployment.resolution.descriptor_closure から再 apply される)
- compute env vars (Deployment.desired.bindings)
- routes (Deployment.desired.routes / activation_envelope)
- publication declarations (Deployment.desired)
- consume declarations (Deployment.desired.bindings)
- source metadata / artifacts / runtime env (Deployment.input)

## rollback で戻らないもの

- DB data (forward-only migration / MigrationLedger は逆実行されない)
- object-store / key-value のデータ
- secret values (auto-generated は再生成しない)
- consumed publication output values (rollback 後の serving 時に再解決)
- group 削除時の resource (uninstall は terminal)

## rollback は GroupHead 単位の操作

Takos における **rollback は group の GroupHead を retained Deployment へ
切り替える pointer move** です。新しい Deployment record も、新しい
descriptor closure resolution も作りません。個別 Worker / Service / Attached
Container を選んで戻す操作はありません。

git checkout して再 deploy するのは「コードを編集して新しい Deployment を作る」
通常の deploy フローです。rollback API を経由せずに別の commit / branch を
反映したい場合は、通常通り `takos deploy --space SPACE_ID --group GROUP_NAME`
を実行してください (新しい Deployment が resolve + apply されます)。

repo URL から `takos deploy --space SPACE_ID --group GROUP_NAME` した group /
`takos install OWNER/REPO --space SPACE_ID --group GROUP_NAME` した group /
ローカル deploy した group のいずれも、`takos rollback GROUP_NAME --space SPACE_ID`
で GroupHead を previous Deployment に戻せます。

## retain される descriptor closure / artifacts

GroupHead.previous_deployment_id が指す Deployment は、rollback window のあいだ
以下を retain しなければなりません。

- `Deployment.input.manifest_snapshot` (canonical bytes)
- `Deployment.resolution.descriptor_closure` (descriptor digest がすべて pin
  されている)
- `Deployment.desired` (routes / bindings / resources / runtime_network_policy /
  activation_envelope)

これらが破棄された Deployment は rollback target にできません。rollback
は記録済みの descriptor closure を使って apply し直すため、Apply 時に descriptor
URL を再解釈することはありません。

## digest pin の扱い

`compute.<name>` の image-backed workload は digest pin された `image` (64-hex
`sha256` digest) だけが Deployment.desired に入ります。mutable tag は current
contract では resolve 自体が失敗するため、rollback 対象になる Deployment は
すべて digest pin 済みです。

## uninstall との関係

`takos uninstall` は group を terminal に削除する操作です。manifest-managed
workload / route / publication を drain したあと group row も削除するため、
あとから `takos rollback ...` を実行しても deleted group の GroupHead は復元
されません。

## 複数 Worker / Service / Attached Container を含む group の rollback

`takos deploy` で複数の Worker / Service / Attached Container を含む group を
deploy している場合、`takos rollback GROUP_NAME --space SPACE_ID` は **GroupHead
を previous Deployment に切り替えるだけ**です。Deployment は group 全体を 1
record として持つため、内訳の Worker / Service / Attached Container は同じ
Deployment.desired に含まれる version でまとめて元の状態に戻ります。個別
Worker / Service / Attached Container だけを rollback することはできません。

```bash
takos rollback my-app --space SPACE_ID
```

`depends` の順序解決、Attached Container と Worker の対応関係、consume output
の再解決は rollback 後の serving 時に kernel 側で行われるため、ユーザーが手動で
順番を意識する必要はありません。

### DB スキーマ・データは自動ロールバックされない

::: danger sql / object-store / key-value への書き込みはロールバックされません。
:::

rollback で戻るのは Deployment.desired (compute コード / env / routes /
bindings / publication declaration) だけです。以下は手動対応が必要です:

- **sql**: スキーマ変更（ALTER TABLE など）を手動で巻き戻す（migration は
  forward-only / MigrationLedger は逆実行されない）
- **object-store**: 書き込まれたオブジェクトの削除・復元
- **key-value**: 書き込まれたキーの削除・復元
- **外部サービス**: Webhook 登録や外部 API の状態変更

DB マイグレーションは expand-only にしておくと、rollback 時のリスクを減らせます。

## ロールバックのベストプラクティス

1. **deploy 前に Deployment を確認する**:
   `takos deploy --resolve-only --space SPACE_ID --group GROUP_NAME` で resolved
   Deployment を作り、`takos diff <id>` で expansion / GroupHead との差分を
   確認する
2. **DB マイグレーションは expand-only に**: カラム追加は nullable
   にし、破壊的変更は段階的に反映する
3. **rollback は GroupHead 単位の一括操作**:
   `takos rollback GROUP_NAME --space SPACE_ID` は GroupHead を previous
   Deployment に切り替える。個別 Worker / Service / Attached Container を
   選んで rollback することはできない
4. **rollback と redeploy を混同しない**: 「以前のコードに戻したい」だけなら
   git の履歴を遡って通常の `takos deploy --space SPACE_ID --group GROUP_NAME`
   を実行する (新しい Deployment が作られる)。`takos rollback` は GroupHead を
   既存 retained Deployment に切り替えるための専用 API

## 次のステップ

- [deploy](/deploy/deploy) --- `takos deploy` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由のデプロイ
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
