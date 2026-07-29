# Takos をセルフホストする

Takos は、自分の Cloudflare アカウントへ配置できます。このリポジトリの `deploy/opentofu` が、必要なクラウドリソースを定義します。

このページは運用者向けです。Takos を利用するだけなら、[スタートガイド](/get-started/) へ進んでください。

## 何が配置されるか

現在のセルフホスト構成は Cloudflare に対応します。

- Takos の Worker と静的 UI
- D1 データベース
- R2 バケット
- KV
- Queue
- Vectorize
- エージェント実行に必要な構成

OpenTofu はリソースと Worker に渡す binding を作ります。Worker のコードは、この binding を使って起動します。

## Takosumi は必須か

OpenTofu モジュール自体は標準的な IaC です。運用者が自分の方法で `tofu plan` / `tofu apply` を実行できます。

Takosumi を使うと、Git ソース、確認済み plan、apply の結果、output、監査記録を一つの管理画面と API で扱えます。Takos 自体は、これらのデプロイ制御を実装しません。

## 必要なもの

- OpenTofu 1.5 以降
- Cloudflare アカウントと必要な権限
- Takosumi Accounts の URL、issuer、OIDC client
- Takos の公開 URL
- Worker artifact をアップロードする手順
- 本番用の secret を保管する仕組み

secret を `.tfvars`、OpenTofu output、Git リポジトリへ保存しないでください。

## 基本の流れ

1. このリポジトリを tag または commit に固定する
2. `deploy/opentofu/opentofu.tfvars.example` を参考に、運用環境の入力を用意する
3. `tofu init` と `tofu plan` を実行する
4. 作成・変更・削除と料金を確認する
5. 確認した plan を apply する
6. 同じ commit から Worker artifact をビルドしてアップロードする
7. 公開 URL、ログイン、Chat、エージェント実行を確認する

```sh
cd deploy/opentofu
tofu init
tofu plan -var-file=opentofu.tfvars
tofu apply
```

実際の入力名は [環境と変数](/deploy/environment) を参照してください。Worker の公開は [デプロイ手順](/deploy/deploy) に分けています。

## アプリとの連携

Workspace に追加するアプリも、Git リポジトリにある OpenTofu モジュールとして扱えます。

アプリは、通常の OpenTofu output で起動 URL などを返します。Takos から使う画面、MCP、ファイル形式などは、アプリの公開情報として Takosumi が記録します。認証情報は output に含めません。

詳しくは [OpenTofu output とアプリの公開先](/deploy/runtime-interfaces) を参照してください。

## 配置後の確認

- 公開 URL が 200 を返す
- OIDC でサインインできる
- Workspace を作成または開ける
- Chat からエージェントを実行できる
- 完了または失敗の状態が記録される
- 必要な D1、R2、KV、Queue へアクセスできる
- ロールバックする commit と手順が決まっている

問題がある場合は [トラブルシューティング](/deploy/troubleshooting) を参照してください。

## 関連ページ

- [環境と変数](/deploy/environment)
- [デプロイ手順](/deploy/deploy)
- [ルートとドメイン](/deploy/routes)
- [ロールバック](/deploy/rollback)
- [トラブルシューティング](/deploy/troubleshooting)
