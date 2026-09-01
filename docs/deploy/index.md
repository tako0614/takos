# Takos をセルフホストする

TakosはTakoform対応hostまたは自分のCloudflare accountへ配置できます。この
リポジトリの`deploy/opentofu/takoform`と`deploy/opentofu/cloudflare`が、同じ
product resource contractをそれぞれのtargetへ写します。

このページは運用者向けです。Takos を利用するだけなら、[スタートガイド](/get-started/) へ進んでください。

## 何が配置されるか

既定のTakoform adapterは、選択したTakoform対応hostへ次の論理リソースを要求します。直接Cloudflare adapterを選んだ場合は、それぞれをWorkers、D1、R2、KV、Queues、Vectorize、Containersへ写します。

- Takos の Worker と静的 UI
- relational database
- object bucket
- key-value store
- Queue
- vector index
- エージェント実行に必要な構成

OpenTofu はリソースと Worker に渡す binding を作ります。Worker のコードは、この binding を使って起動します。

## Takosumi integrationはoptional

OpenTofu module自体は標準的なIaCで、運用者が自分の方法で`tofu plan` / `tofu
apply`を実行できます。その場合もChat、agent、Memory、app-local Workspaceは
動きます。

Takosumiを接続すると、Git source、確認済みplan、apply結果、state、output、audit、
shared Capsule state、Interfaceを一つのauthorityで扱えます。未接続時にTakosが
それらの代替ledgerを持つのではなく、その共有機能だけがunavailableになります。

## 必要なもの

- OpenTofu 1.5 以降
- 選択したTakoform hostへの接続、またはCloudflare direct用のアカウントと必要な権限
- operator-selected OIDC issuerとclient
- shared control-plane機能を使う場合はTakosumi URL
- Takos の公開 URL
- Worker artifact をアップロードする手順
- 本番用の secret を保管する仕組み

secret を `.tfvars`、OpenTofu output、Git リポジトリへ保存しないでください。

## 基本の流れ

1. このリポジトリをtagまたはcommitに固定する
2. 選んだadapterの変数を確認する
3. `tofu init`と`tofu plan`を実行する
4. 作成・変更・削除と料金を確認する
5. 確認したplanをapplyする
6. 同じcommitのWorker artifactをapp-owned materializerで反映する
7. 公開URL、OIDC login、Chat、エージェント実行を確認する

Takosumiを使う場合は同じmoduleをSource/Capsuleとして登録し、plan/applyとevidenceを
Takosumi Runとして管理します。local product integrationでは
`takosumi-dev-server`を使えますが、そこでのsimulationはinfrastructure evidence
ではありません。

実際の入力名は [環境と変数](/deploy/environment) を参照してください。Worker の公開は [デプロイ手順](/deploy/deploy) に分けています。
Takosumi lifecycle action との正確な境界は
[Worker artifact materializer](/deploy/product-materializer) を参照してください。

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
- [Worker artifact materializer](/deploy/product-materializer)
- [トラブルシューティング](/deploy/troubleshooting)
