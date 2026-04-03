# Takos 全体像

Takos は、AI エージェント時代のサービスとソフトウェアを動かすための infra kernel
と workspace shell です。プロダクト UI は Takos 本体に埋め込むのではなく、Takos
上で動く installable app として扱います。

このページは、`.takos/app.yml` や CLI の詳細に入る前に、「Takos
をどの単位で理解すればよいか」を揃える入口です。

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
- App: workspace に接続される installable product surface
- Worker / Service: deployable workload
- Resource / Binding: backing capability と接続
- Canonical URL: app が所有する正本 URL

## public と internal の読み分け

Takos Docs では、次の 3 層を分けて読みます。

1. public contract
2. implementation note
3. internal model

採用判断に使うのは `apps/` と `reference/` です。`architecture/` は、Takos
が内側でどう動いているかを理解するための章です。

## 代表的なユースケース

### アプリを配備したい人

- `.takos/app.yml` を書く
- workflow artifact を用意する
- 開発中は `takos plan` / `takos apply` を使う
- canonical repository URL や catalog package からは `takos deploy` /
  `takos install` を使う

### workspace を運用したい人

- shell から workspace / resources / deploys / installed apps を見る
- canonical URL と shell launch URL の違いを理解する
- default apps を preinstall しつつ、必要なら uninstall / replace する

### operator

- space / repo / resource / route の関係を把握する
- rollback / provider 差分 / source provenance を確認する

### internal 実装者

- public contract と internal model の境界を確認してから code を追う

## 最初に読むページ

- Takos の product boundary は [アーキテクチャ](/architecture/) と
  [Kernel / Workspace Shell / Apps](/architecture/kernel-shell)
- app の deploy/runtime contract は [アプリ構成](/apps/) と [デプロイ](/deploy/)
- CLI / API は [リファレンス](/reference/)

## 次に読むページ

- [はじめる](/get-started/)
- [アプリ構成](/apps/)
- [デプロイ](/deploy/)
