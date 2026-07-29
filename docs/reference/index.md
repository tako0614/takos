# リファレンス

設定名、API、データの所有者を調べるためのページです。Takos を初めて使う場合は、先に [スタートガイド](/get-started/) を参照してください。

## ページ一覧

| ページ | 内容 |
| --- | --- |
| [API](/reference/api) | Takos が提供する HTTP API |
| [用語集](/reference/glossary) | Takos と Takosumi で使う用語 |
| [データベースの所有者](/reference/database) | 各データをどのサービスが保持するか |
| [環境と変数](/deploy/environment) | セルフホスト時の設定 |
| [トラブルシューティング](/deploy/troubleshooting) | よくある失敗と確認方法 |

## API を使う前に

Takos の API は、ブラウザセッションまたは用途を限定した bearer token で利用します。Workspace のメンバー権限は、token があっても省略されません。

外部サービスとの接続やアプリのデプロイには Takosumi の API も登場します。次の境界で判断してください。

- Chat、Files、Memory、Apps、MCP Connections: Takos API
- アカウント、アプリの OpenTofu plan/apply、デプロイ履歴: Takosumi API

Takosumi 固有の API は [Takosumi docs](https://takosumi.com/docs/) を参照してください。
