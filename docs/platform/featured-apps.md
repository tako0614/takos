# おすすめアプリ (featured apps)

featured apps は、Takos の配布側が「まずこれを」と用意するアプリのカタログです。
並ぶのはすべて普通の Capsule アプリで、Git リポジトリから Takosumi の reviewed な
Run を通して install されます。Takos だけの特別なアプリ形式はありません。

## カタログの中身

各エントリは表示名、アイコン、Git の repository URL と ref、並び順、有効フラグを持ちます。
preinstall が立ったエントリは、Workspace 作成時の「デフォルトアプリを install」
設定が有効なときに自動で追加されます。それ以外は Apps 画面から利用者が選んで追加します。

カタログは配布側の設定です。どのエントリも install の実行権限を変えず、通常の
plan / apply の確認はそのまま行われます。

## first-party の例

| アプリ | 内容 |
| --- | --- |
| [takos-office](/platform/takos-office) | 文書・スライド・表計算を 1 つの worker にまとめた office suite |
| [takos-computer](/platform/takos-computer) | エージェントが MCP 経由で使うサンドボックス実行環境 |
| [yurucommu](/platform/yurucommu) | ActivityPub 対応のセルフホスト SNS |

## 関連ページ

- [Capsule を発見して install する](/platform/store)
- [Install paths](/apps/install-paths)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
