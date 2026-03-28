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

## deploy-group のロールバック

`takos deploy-group` にはロールバックコマンドがありません。以前のコードで再度 `deploy-group` を実行してください。

```bash
# 前のバージョンのコードに戻して
git checkout v1.0.0

# 再デプロイ
takos deploy-group --env staging
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

## ロールバックのベストプラクティス

1. **デプロイ前に dry-run で確認する**: `takos deploy-group --dry-run` で事前確認
2. **DB マイグレーションは後方互換に**: ロールバック時に旧コードが動くよう、カラム追加は nullable にする
3. **段階的にデプロイする**: rollout を使って少しずつ公開し、問題があれば早めに中止

## 次のステップ

- [deploy-group](/deploy/deploy-group) --- デプロイコマンドの詳細
- [Store 経由デプロイ](/deploy/store-deploy) --- Store 経由のデプロイ
- [トラブルシューティング](/deploy/troubleshooting) --- よくあるエラーと対処
