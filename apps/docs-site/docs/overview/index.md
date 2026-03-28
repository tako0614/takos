# Takos overview

Takos は、AI を含む app と worker ベースの service を、同じ control plane で管理・配備・実行するための platform です。
この overview は、細部の仕様より前に「Takos をどの単位で理解すればよいか」を揃える入口です。

## このページで依存してよい範囲

- Takos の全体像
- docs の読み順
- public 用語と internal 用語の大まかな対応

## このページで依存してはいけない範囲

- provider 固有の lower-level route
- internal table 名
- 個別 API / CLI / manifest の詳細契約

## Takos が扱う基本単位

- Workspace / Space: 所有と隔離
- Repo: source と workflow artifact の起点
- Worker: public surface での deployable unit
- Resource / Binding: backing capability と接続
- Thread / Run / Artifact: AI 実行の履歴と結果

## public と internal の読み分け

Takos Docs では、次の 3 層を分けて読みます。

1. public contract
2. implementation note
3. internal model

採用判断に使うのは `specs/` と `reference/` です。
`architecture/` は、Takos が内側でどう動いているかを理解するための章です。

## 代表的なユースケース

### app を配備したい人

- `.takos/app.yml` を書く
- workflow artifact を用意する
- `takos deploy` または `app-deployments` API を使う

### operator

- space / repo / resource / route の関係を把握する
- rollout / rollback / provider 差分を確認する

### internal 実装者

- public contract と internal model の境界を確認してから code を追う

## 最初に読むページ

- はじめる は [Get Started](/get-started/)
- manifest と deploy は [アプリ開発](/apps/) と [デプロイ](/deploy/)
- CLI / API は [リファレンス](/reference/)
- internal 構成は [アーキテクチャ](/architecture/)

## 次に読むページ

- [はじめる](/get-started/)
- [アプリ開発](/apps/)
- [デプロイ](/deploy/)
