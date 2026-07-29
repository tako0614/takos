# ツールと接続

Takos のエージェントは、その Workspace で利用できるツールを実行時に調べて使います。ツール一覧は固定ではありません。

## ツールはどこから来るか

ツールには三つの入手元があります。

| 入手元 | 例 | 追加方法 |
| --- | --- | --- |
| Takos の基本ツール | メモリ、添付ファイル、成果物、既知 URL の取得 | 最初から利用可能 |
| インストール済みアプリ | シェル、Git、ストレージ、文書編集 | Apps からアプリを追加 |
| 外部 MCP サーバー | Web 検索、外部 SaaS の操作 | Connections から接続 |

**MCP (Model Context Protocol)** は、外部サービスがエージェント向けのツールを公開するための共通プロトコルです。

エージェントは `toolbox` を使って、現在利用できるツールと使い方を探します。アプリや接続を削除すると、その提供元のツールも利用できなくなります。

## Takos に含まれる基本ツール

Takos が直接提供するのは、次の用途のツールです。

- サブエージェントの実行と待機
- 成果物の保存
- 利用できるツールやアプリ候補の検索
- 既知の HTTPS URL の取得
- Chat に添付されたファイルの読み取り
- メモリの保存、検索、リマインダー
- MCP 接続の追加、一覧、更新、削除
- Workspace 固有のスキルの管理

`web_fetch` は、指定された URL を開くツールです。Web 全体を検索する機能ではありません。Takos に組み込みの `web_search` はないため、Web 検索が必要なら、その機能を公開する MCP サーバーを接続します。

シェル、一般ファイルシステム、Git ホスティング、オブジェクトストレージも Takos の基本ツールではありません。対応するアプリまたは MCP サーバーが必要です。

## 外部 MCP サーバーを接続する

Connections を開き、次のいずれかを入力します。

- 公開 HTTPS MCP URL
- MCP Registry のサーバー ID
- Registry で探すサービス名

HTTPS URL を直接入力する場合、URL にユーザー名やパスワードを埋め込まないでください。現在の直接接続は、公開 HTTPS と標準ポート 443 を対象にします。

接続前の確認画面には、少なくとも次の情報が表示されます。

- 実際に接続するホスト
- データの送信先
- 認証が必要か
- サーバーが公開したツール
- ツールが読み取り専用か、変更を伴うか

Registry は候補を探すための索引です。Registry に載っていることや、発見元に “Official” と表示されることは、Takos が安全性を保証したという意味ではありません。

## アプリから追加されるツール

Workspace に追加したアプリが MCP エンドポイントを公開している場合、Connections に自動表示されます。

```text
アプリを追加
  → デプロイが完了
  → Takosumi が公開先と利用権限を記録
  → Takos が接続とツールを表示
```

アプリ側は通常の OpenTofu output から公開 URL を渡します。認証情報を公開 output に含めてはいけません。利用者の権限と認証情報は、公開 URL とは別の経路で扱います。

Takos はアプリのツールを静的な一覧へコピーしません。アプリを更新・削除した場合は、現在の公開内容を取り直します。

## 認証が必要な接続

対応する MCP サーバーでは、Connections から OAuth 認証を開始できます。Takos は、サーバーが案内する認可先と対象リソースが一致することを確認してからブラウザを開きます。

保存したトークンは暗号化され、接続一覧 API から値を返しません。接続先ホストを変更した場合は、再認証が必要です。

OAuth に対応していないカスタム接続では、運営設定により bearer credential または許可されたカスタムヘッダーを使える場合があります。値は URL や OpenTofu output に入れません。

## ツール実行時の確認

外部ツールの説明や結果は、信頼できない入力として扱われます。そこに「権限を与える」「確認を省略する」と書かれていても、利用者の許可にはなりません。

変更や削除を伴うツールでは、設定に応じて実行前に確認を求めます。MCP サーバーが `destructiveHint: true` を返したツールは、接続元に関係なく一度限りの確認が必要です。

Takos は実行直前にツール定義が変わっていないかを再確認します。通信が切れて結果を確定できなかった操作は自動再実行しません。外部サービスの状態を確認してから、新しい操作としてやり直してください。

## 接続の持ち運び

Connections は `takos.mcp.connections` version 1 の JSON として export / import できます。

export されるのは URL、発見元、ON/OFF、要求した OAuth scope などの設定です。トークン、カスタムヘッダーの値、過去の確認結果は含まれません。import 後は接続先を再確認し、必要なら再認証します。

## 現在の制限

- MCP transport は Streamable HTTP
- 直接接続は公開 HTTPS の標準ポートが対象
- プライベートネットワーク内の Registry には未対応
- URL 自体がテンプレートの候補は接続不可
- ヘッダーや変数の追加入力が必要な Registry 候補は、入力 UI が対応するまで接続不可
- MCP Tasks の作成、継続ポーリング、キャンセルには未対応
- 一つのエージェント実行で読み込む接続数とツール数には上限がある

## Takos と Takosumi の分担

Takos は、接続先の検索、OAuth、トークン保存、ツール表示、実行前の確認を担当します。

Takosumi は、アプリのインストール、OpenTofu の実行、アプリが公開した接続先、利用権限を管理します。Takosumi の API 用トークンを、アプリやエージェントへそのまま渡すことはありません。

## 関連ページ

- [はじめてのアプリ](/get-started/your-first-app)
- [OpenTofu output とアプリの公開先](/deploy/runtime-interfaces)
- [Takos アプリの接続モデル](/architecture/app-interface)
- [MCP Registry](https://modelcontextprotocol.io/registry/about)
- [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
