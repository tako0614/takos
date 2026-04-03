# ロールバック

> このページでわかること: デプロイをロールバックする手順と注意点。

## Repository / Catalog デプロイ (`takos deploy`) のロールバック

```bash
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

ロールバックは、前回成功 deployment で保存した immutable snapshot
を再適用する操作です。branch の移動や tag の付け替えには影響されません。
snapshot に保存された execution context も戻すため、provider と env も rollback
対象です。

対象 deployment の group row が既に削除されている場合、rollback は失敗します。
rollback が削除済み group を再生成することはありません。

### ロールバックで戻るもの

- Worker のコード
- Worker の設定（バインディング、環境変数）
- provider / env
- Route の割り当て

### ロールバックで戻らないもの

以下は自動では巻き戻されません。手動での対応が必要です。

- DB スキーマ・データの巻き戻し
- R2 / KV に書き込まれたデータの削除
- 外部サービスへの副作用の復元

## apply のロールバック

`takos apply` にはロールバックコマンドがありません。以前のコードで再度 `apply`
を実行してください。

```bash
# 前のバージョンのコードに戻して
git checkout v1.0.0

# 再デプロイ
takos apply --env staging
```

## digest pin の扱い

`services` / `containers` は digest pin された `imageRef` (`@sha256:...`) だけが
rollback 対象になります。mutable tag は current contract では deploy
自体を拒否します。

## uninstall との関係

`takos uninstall` は group を terminal に削除する操作です。managed resources を
drain したあと group row も削除するため、あとから `takos deploy rollback ...` を
実行しても deleted group は復元されません。

## 複数 Worker のロールバック

`apply` で複数の Worker / Container
をデプロイしている場合、ロールバックにはいくつか注意点があります。

### 各 Worker は独立してロールバック

Worker 同士は独立したデプロイ単位なので、1
つだけロールバックすることもできます。

```bash
# Worker "api" だけ前のバージョンに戻す
git checkout v1.0.0
takos apply --env production --target workers.api
```

### binding で依存する Worker がある場合

Worker 間で Service
Binding（`bindings.services`）を使っている場合、依存元（呼び出し先）から順にロールバックするのが安全です。

```text
例: web → api → internal

ロールバック順:
  1. internal（依存されている側から）
  2. api
  3. web（依存している側を最後に）
```

逆順にすると、新しい API を期待する Worker が古い Worker
を呼び出してエラーになる可能性があります。

### Container は Worker と一体でロールバック

Container は Worker の Durable Object
として紐づいてデプロイされるため、Container
だけを個別にロールバックすることはできません。Worker をロールバックすると
Container も一緒に戻ります。

```bash
# Worker "browser-worker" をロールバックすると、
# 紐づく Container も一緒にロールバックされる
takos apply --env production --target workers.browser-worker
```

### DB スキーマ・データは自動ロールバックされない

::: danger D1 / R2 / KV への書き込みはロールバックされません。 :::

ロールバックで戻るのは Worker のコードと設定だけです。以下は手動対応が必要です:

- **D1**: スキーマ変更（ALTER TABLE など）を手動で巻き戻す
- **R2**: 書き込まれたオブジェクトの削除・復元
- **KV**: 書き込まれたキーの削除・復元
- **外部サービス**: Webhook 登録や外部 API の状態変更

DB
マイグレーションは常に後方互換にしておくと、ロールバック時のリスクを減らせます。

## ロールバックのベストプラクティス

1. **デプロイ前に manifest を検証する**: `takos plan` で non-mutating preview
   を確認
2. **DB マイグレーションは後方互換に**:
   ロールバック時に旧コードが動くよう、カラム追加は nullable にする
3. **依存順を意識する**: 複数 Worker
   のロールバックでは、依存元（呼び出し先）から順に戻す
4. **Container は Worker と一体**: Container
   だけの個別ロールバックはできないことを覚えておく

## 次のステップ

- [apply](/deploy/apply) --- `takos apply` の詳細
- [Repository / Catalog デプロイ](/deploy/store-deploy) --- repository / catalog
  経由のデプロイ
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
