# トラブルシューティング

まず「利用者の操作」「Takos」「Takosumi のデプロイ管理」「クラウド」のどこで失敗したかを分けます。画面のエラーだけで判断せず、同じ時刻の API 応答と実行記録を確認してください。

## 最初に確認する

ローカル環境:

```sh
bun run doctor
bun run local:config
bun run local:logs
bun run local:smoke
```

ソースの検証:

```sh
bun run check
bun run docs:build
```

セルフホスト環境では、対象 commit、Worker version、OpenTofu state、直近の plan/apply、Cloudflare のログをそろえます。secret や認証 cookie はログや issue に貼らないでください。

## サインイン後に画面が戻る

確認するもの:

1. Takos の公開 URL
2. Takosumi Accounts の issuer URL
3. OIDC client ID
4. 登録された redirect URI
5. ブラウザが実際に開いた origin と scheme

redirect URI は文字列が完全一致する必要があります。ローカルと本番の URL を混ぜないでください。

## Workspace や API が 500 を返す

1. 応答の request ID を控える
2. 同じ request ID の Worker ログを探す
3. `GET /internal/runtime/status` で schema が `ready` か確認する
4. binding 名と実際のリソース ID を確認する
5. 一覧 API の入力件数が D1 / SQLite の変数上限を超えていないか確認する

大量の ID を一つの `IN (...)` に渡す実装は、D1 の SQL 変数上限で失敗します。ページング、件数制限、または分割取得が必要です。

## エージェントが開始しない

1. Chat に実行状態が作られているか確認する
2. エージェント実行サービスのヘルスを確認する
3. Queue と callback の binding を確認する
4. モデル接続と利用上限を確認する
5. 実行が `queued`、`running`、`failed` のどこで止まったか確認する

通知の有無ではなく、Chat に記録された実行状態を正しい結果として扱います。

## ツールが見つからない

Takos のツール一覧は固定ではありません。

1. Connections で接続が有効か確認する
2. アプリ由来なら、そのアプリのデプロイが完了しているか確認する
3. MCP サーバーの `tools/list` が成功するか確認する
4. Workspace の権限とツール利用設定を確認する
5. Chat を再読み込みし、現在の一覧を取り直す

`web_fetch` は Web 検索ではありません。Web 検索ツールが必要なら、対応する MCP サーバーを接続します。

## アプリが表示されない

1. Apps でインストール状態を確認する
2. apply が成功しているか確認する
3. 起動 URL または UI の公開情報が記録されているか確認する
4. 公開 URL が安全な HTTPS URL として受理されているか確認する
5. 対象 Workspace に利用権限があるか確認する

画面を持たないサービスは、Apps に起動ボタンを表示しない場合があります。MCP ツールだけを提供するサービスは Connections も確認してください。

## 通知が届かない

1. 実行を依頼したアカウントか確認する
2. 実行が完了または失敗として記録されているか確認する
3. 通知設定と端末の許可を確認する
4. 運営者は通知キューと push 配送のログを確認する

現在、Takos のモバイル push はエージェント実行の完了と失敗が対象です。詳しくは [通知](/get-started/notifications) を参照してください。

## OpenTofu の plan / apply が失敗する

1. 使用した Git commit と module path を確認する
2. `tofu validate` を実行する
3. provider の認証と権限を確認する
4. plan の診断を最初のエラーから読む
5. apply が失敗した場合は、一部のリソースだけ作成されていないか state とクラウドを確認する

同じ apply を無条件に再実行しないでください。外部操作の結果が不明な場合は、現在のクラウド状態を先に確認します。

## さらに調べる

- [環境と変数](/deploy/environment)
- [ルートとドメイン](/deploy/routes)
- [ロールバック](/deploy/rollback)
- [ツールと接続](/apps/mcp)
- [API リファレンス](/reference/api)
