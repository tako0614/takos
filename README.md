# Takos

Takos は、AI エージェントに作業を頼み、その結果をファイル・Git・メモリ・アプリへ残せるワークスペースです。チャットだけでなく、作業に必要な道具と成果物を同じ場所で扱えます。

このリポジトリには、ブラウザ UI、API を提供する Worker、エージェント実行サービス、セルフホスト用の OpenTofu モジュールが入っています。

ドキュメント: <https://docs.takos.jp/>

## Takos でできること

- エージェントに調査、実装、文書作成などを依頼する
- 会話と作業結果を Workspace 単位で整理する
- 必要なアプリを Git URL から追加して、Apps 画面から開く
- MCP サーバーを接続し、そのツールをエージェントから使う
- エージェントの回答が完了または失敗したときに通知を受け取る
- Takosumi Cloud などの Takoform 対応ホストへ配置する
- 必要なら自分の Cloudflare アカウントへ直接セルフホストする

**Workspace** は、会話、ファイル、リポジトリ、メモリ、アプリ、接続をまとめる作業場所です。新しい Workspace にアプリは自動追加されません。必要なものだけを選んで追加します。

## まず使ってみる

運営者から Takos の URL を受け取っている場合は、サインインして Workspace を作成し、Chat で次のように依頼します。

```text
この Workspace の README を読んで、次にやることを3つに整理して。
```

ローカルで開発環境を起動する場合は、Bun と Docker が必要です。

```sh
bun install
bun run doctor
bun run local:config
bun run local:up
```

起動後の確認と終了:

```sh
bun run local:smoke
bun run local:down
```

詳しい手順は [スタートガイド](https://docs.takos.jp/get-started/) と [ローカル開発](https://docs.takos.jp/get-started/local-development) を参照してください。

## ツールと接続

Takos には、メモリ、添付ファイル、成果物の保存、既知の URL の取得など、基本的なツールが含まれます。

一方、シェル、Git ホスティング、オブジェクトストレージ、Web 検索などは、存在しない機能を組み込みとして仮定しません。インストール済みアプリや接続済み MCP サーバーが公開したツールを実行時に取得し、エージェントが `toolbox` から探します。

つまり、ツール一覧は固定ではありません。

```text
Takos の基本ツール
  + インストール済みアプリが公開するツール
  + 接続済み MCP サーバーが公開するツール
  = その Workspace で利用できるツール
```

接続方法と安全確認は [ツールと接続](https://docs.takos.jp/apps/mcp) を参照してください。

## Takos と Takosumi

Takos は利用者が触る AI ワークスペースを提供します。Takosumi は別プロジェクトで、ホスト環境のアカウント、アプリのインストール、OpenTofu の実行履歴を管理します。

Takos 自体に独自のデプロイ制御やクラウド provider はありません。セルフホスト用の構成は通常の OpenTofu モジュールであり、Takosumi から実行することも、運用者が自分の手順で実行することもできます。

Takosumi の install は、Git repository URL、ref（tag または commit）、module path
（repository 内の OpenTofu サブディレクトリ）を指定して開始します。Takosumi は指定した
commit の OpenTofu tree を走査し、通常の module と
[`/.well-known/takosumi.json`](.well-known/takosumi.json) の repository-owned
hints / service 宣言を導入画面に反映します。Takos の現在の supported adapter は
`deploy/opentofu/cloudflare` で、Takos の完全な resource graph を表します。旧
`deploy/opentofu/takoform` tree は現行 Form 群で全 graph を表せないため、新規 install
には使いません。`install.modules` のキーは、Git/OpenTofu tree で実在を確認した module
path に紐づく補助 metadata であり、候補の作成・順序付け・既定値の決定はしません。候補の
選択は Git URL、ref、module path と tree scan が担います。takos.jp の直接 CTA も、この
Git URL install 導線を使います。

v2.3 の `interfaces` 宣言は、Takos の `interface.ui.surface@1` launcher と
`launch_url` Output の明示的な mapping を提案し、レビュー後に Takosumi が Interface へ
compile します。これは provider credential、Cloudflare account、target、実行権限を
含まない repository-owned metadata です。Interface ID、endpoint、provider、credential は
repository に書きません。`launch_url` Output だけで launcher を推測する fallback はありません。
最終的な InstallConfig、Plan、Apply、InterfaceBinding の authority は Takosumi 側に残ります。

## リポジトリ構成

```text
src/worker/       Worker、API、Takos のサーバー処理
web/              ブラウザ UI
containers/agent/ エージェント実行サービス
deploy/opentofu/  provider別のセルフホスト用 OpenTofu adapter
docs/             docs.takos.jp のソース
```

## よく使うコマンド

| コマンド | 用途 |
| --- | --- |
| `bun run doctor` | 必要なツールとローカル構成を確認する |
| `bun run local:up` / `local:down` | ローカル環境を起動・終了する |
| `bun run local:logs` | ローカル環境のログを見る |
| `bun run local:smoke` | 起動したサービスの疎通を確認する |
| `bun run local:e2e` | ローカル E2E テストを実行する |
| `bun run check` | 型、テスト、アーキテクチャ境界、ビルドを検証する |
| `bun run docs:dev` | ドキュメントをローカルで表示する |
| `bun run docs:build` | ドキュメントをビルドする |

## 次に読む

- [スタートガイド](https://docs.takos.jp/get-started/)
- [ツールと接続](https://docs.takos.jp/apps/mcp)
- [通知](https://docs.takos.jp/get-started/notifications)
- [セルフホスト](https://docs.takos.jp/deploy/)
- [トラブルシューティング](https://docs.takos.jp/deploy/troubleshooting)
- [API リファレンス](https://docs.takos.jp/reference/api)
