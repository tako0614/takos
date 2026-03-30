# ロールバック

> このページでわかること: デプロイをロールバックする手順と注意点。

## Store 経由デプロイ (`takos deploy`) のロールバック

```bash
takos deploy rollback APP_DEPLOYMENT_ID --space SPACE_ID
```

ロールバックは「前の app deployment の状態に戻す」操作です。

### ロールバックで戻るもの

- Worker のコード
- Worker の設定（バインディング、環境変数）
- Route の割り当て

### ロールバックで戻らないもの

以下は自動では巻き戻されません。手動での対応が必要です。

- DB スキーマ・データの巻き戻し
- R2 / KV に書き込まれたデータの削除
- 外部サービスへの副作用の復元

## apply のロールバック

`takos apply` にはロールバックコマンドがありません。以前のコードで再度 `apply` を実行してください。

```bash
# 前のバージョンのコードに戻して
git checkout v1.0.0

# 再デプロイ
takos apply --env staging
```

## rollout の制御

Store 経由デプロイでは、段階的公開（rollout）を制御できます。問題があればロールバック前に rollout を停止できます。

```bash
# rollout を一時停止
# API: POST /api/spaces/:spaceId/app-deployments/:id/rollout/pause

# rollout を中止
# API: POST /api/spaces/:spaceId/app-deployments/:id/rollout/abort

# rollout を再開
# API: POST /api/spaces/:spaceId/app-deployments/:id/rollout/resume

# rollout を即時完了
# API: POST /api/spaces/:spaceId/app-deployments/:id/rollout/promote
```

## 複数 Worker のロールバック

`apply` で複数の Worker / Container をデプロイしている場合、ロールバックにはいくつか注意点があります。

### 各 Worker は独立してロールバック

Worker 同士は独立したデプロイ単位なので、1 つだけロールバックすることもできます。

```bash
# Worker "api" だけ前のバージョンに戻す
git checkout v1.0.0
takos apply --env production --target workers.api
```

### binding で依存する Worker がある場合

Worker 間で Service Binding（`bindings.services`）を使っている場合、依存元（呼び出し先）から順にロールバックするのが安全です。

```text
例: web → api → internal

ロールバック順:
  1. internal（依存されている側から）
  2. api
  3. web（依存している側を最後に）
```

逆順にすると、新しい API を期待する Worker が古い Worker を呼び出してエラーになる可能性があります。

### Container は Worker と一体でロールバック

Container は Worker の Durable Object として紐づいてデプロイされるため、Container だけを個別にロールバックすることはできません。Worker をロールバックすると Container も一緒に戻ります。

```bash
# Worker "browser-worker" をロールバックすると、
# 紐づく Container も一緒にロールバックされる
takos apply --env production --target workers.browser-worker
```

### DB スキーマ・データは自動ロールバックされない

::: danger
D1 / R2 / KV への書き込みはロールバックされません。
:::

ロールバックで戻るのは Worker のコードと設定だけです。以下は手動対応が必要です:

- **D1**: スキーマ変更（ALTER TABLE など）を手動で巻き戻す
- **R2**: 書き込まれたオブジェクトの削除・復元
- **KV**: 書き込まれたキーの削除・復元
- **外部サービス**: Webhook 登録や外部 API の状態変更

DB マイグレーションは常に後方互換にしておくと、ロールバック時のリスクを減らせます。

## ロールバックのベストプラクティス

1. **デプロイ前に manifest を検証する**: `takos plan` で事前確認
2. **DB マイグレーションは後方互換に**: ロールバック時に旧コードが動くよう、カラム追加は nullable にする
3. **段階的にデプロイする**: rollout を使って少しずつ公開し、問題があれば早めに中止
4. **依存順を意識する**: 複数 Worker のロールバックでは、依存元（呼び出し先）から順に戻す
5. **Container は Worker と一体**: Container だけの個別ロールバックはできないことを覚えておく

## 次のステップ

- [apply](/deploy/apply) --- `takos apply` の詳細
- [Store 経由デプロイ](/deploy/store-deploy) --- Store 経由のデプロイ
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
