# Takos をセルフホストする

Takos は自分のCloudflareアカウントへ配置できます。現在のsupported moduleは `deploy/opentofu/cloudflare` で、product resource contractのgraphを宣言します。D1 の schema は install path に関係なく Worker が実行時に適用するので、deploy 側に migration 手順はありません ([スキーマ自動適用と縮退モード](/deploy/runtime-schema-and-capabilities))。Cloudflare provider がまだ表現できない残りの gap は通常の production provider path だけでは反映されず、明示的に reviewed bridge を選んだ disposable E2E でだけ補われます。旧Provider 1.x Takoform projectionは現行Formだけで全graphを表せないため、新規installの選択肢ではありません。

このページは運用者向けです。Takos を利用するだけなら、[スタートガイド](/get-started/) へ進んでください。

## 何が配置されるか

Cloudflare adapterは次の論理リソースをWorkers、D1、R2、KV、Queues、Vectorize、Containersへ写します。

- Takos の Worker と静的 UI
- relational database
- object bucket
- key-value store
- Queue
- vector index
- エージェント実行に必要な構成

OpenTofu はリソースと Worker に渡す binding を作ります。Worker のコードは、この binding を使って起動します。

### スキーマは実行時に収束する

D1 の schema は bridge の責務ではありません。Worker が bundle に埋め込んだ migration set を
lease 付き lock の下で自分で適用し、収束するまで 503 を返します。wrangler、OpenTofu、
Takosumi BYOC、self-host のどの install path でも同じ schema に到達します。apply の前後に
migration step はありません。詳細は
[スキーマ自動適用と縮退モード](/deploy/runtime-schema-and-capabilities) を参照してください。

### Vector index は module が作りません

Cloudflare provider には Vectorize resource がありません。この module は
ordinary provider path で index を作れないので、既定では Worker Version に
`VECTORIZE` binding を置きません。存在しない index を bind すると Worker は
`vectorSearch: vectorize` と報告しながら全ての vector 呼び出しで失敗するので、
宣言済みの `vectorSearch: disabled` として動かします。plan の
`vector_search_capability` output がその答えをそのまま出します。

意味検索を使う配置では、`cloudflare_vectorize_index_name` output が示す index を
自分で作ってから `vector_index_provisioned = true` を指定します。bridge lane は
index を自分で作るので、この input は不要です (同時指定は precondition が拒否します)。

### Cloudflare provider gap bridge

Cloudflare provider がまだ表現できない Vectorize index、container-enabled Durable Object の bootstrap、
Container application の反映には、Takos が所有する補助 bridge があります。
`cloudflare_provider_gap_bridge_mode` は既定値が
`off` で、通常の install や production provider path では bridge は実行されません。検証用の `staging` は
`environment = "staging"` と併せて、また disposable production E2E 用の `disposable-production` は
`environment = "production"` と併せて明示的に選んだ場合だけ有効になります。

`disposable-production` は一回限りの使い捨て環境に限り、
`cloudflare_provider_gap_bridge_acknowledgement = "DISPOSABLE_PRODUCTION_ONE_SHOT"` を完全一致で指定します。
`off` と `staging` では acknowledgement を空欄にしてください。bridge は一般の production deploy を有効にする
ためのものではなく、Container image は immutable digest のまま、destroy 時は所有を証明できる Container application
と Vectorize index だけを削除します。bridge は D1 を読み書きしないので、durable な product data を触ることも、
巻き戻すこともありません。

### ランタイムシークレット

Worker が読む 5 つの runtime secret (`ENCRYPTION_KEY`、`TAKOS_AGENT_START_TOKEN`、
`TAKOS_INTERNAL_API_SECRET`、`PLATFORM_PRIVATE_KEY`、`PLATFORM_PUBLIC_KEY`) は
operator が所有します。module は名前だけを宣言し、値を保持しません。Takosumi の Run は
OpenTofu state を StateVersion として保存するので、module 内で secret を生成すれば
公開された secret になるためです。module は 5 つを Cloudflare の `inherit` binding として
bind します。既定は `runtime_secrets_provisioned = true` で、値がまだ無い初回 install
だけが `false` と `first_install_acknowledgement = "FIRST_INSTALL_WITHOUT_RUNTIME_SECRETS"`
を宣言して apply し、値を投入してから既定に戻します。詳細は
[ランタイムシークレット](/deploy/runtime-secrets) を参照してください。

## Takosumi は必須か

OpenTofu モジュール自体は標準的な IaC です。運用者が自分の方法で `tofu plan` / `tofu apply` を実行できます。

Takosumi を使うと、Git ソース、確認済み plan、apply の結果、output、監査記録を一つの管理画面と API で扱えます。Takos 自体は、これらのデプロイ制御を実装しません。

## 必要なもの

- OpenTofu 1.5 以降
- Cloudflareアカウントと必要な権限
- Takosumi Accounts の URL、issuer、OIDC client
- Takos の公開 URL
- Worker artifact をアップロードする手順
- 本番用の secret を保管する仕組み

secret を `.tfvars`、OpenTofu output、Git リポジトリへ保存しないでください。値の形式と
投入手順は [ランタイムシークレット](/deploy/runtime-secrets) にあります。

## 基本の流れ

1. このリポジトリを tag または commit に固定する
2. 選んだadapterの変数を確認する。Cloudflare directでは `deploy/opentofu/cloudflare/opentofu.tfvars.example` を参考にする
3. `tofu init` と `tofu plan` を実行する
4. 作成・変更・削除と料金を確認する
5. 確認した plan を apply する
6. 同じ commit の Worker artifact を operator-owned deployment で反映する
7. 公開 URL、ログイン、Chat、エージェント実行を確認する

Cloudflareへ直接配置する例:

```sh
cd deploy/opentofu/cloudflare
tofu init
tofu plan -var-file=opentofu.tfvars
tofu apply
```

実際の入力名は [環境と変数](/deploy/environment) を参照してください。Worker の公開は [デプロイ手順](/deploy/deploy) に分けています。
Worker artifact の作成と公開は [release artifact runbook](/deploy/release-artifact) を参照してください。

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
- [ランタイムシークレット](/deploy/runtime-secrets)
- [スキーマ自動適用と縮退モード](/deploy/runtime-schema-and-capabilities)
- [デプロイ手順](/deploy/deploy)
- [ルートとドメイン](/deploy/routes)
- [ロールバック](/deploy/rollback)
- [Release artifact runbook](/deploy/release-artifact)
- [本番デプロイレーン](/deploy/production-lane)
- [サイトとドキュメントの配置](/deploy/site-and-docs)
- [トラブルシューティング](/deploy/troubleshooting)
