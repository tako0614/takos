# Takos 全体像

Takos は、AI エージェント時代のサービスとソフトウェアを動かすための infra kernel
です。プロダクト UI は kernel に埋め込むのではなく、Takos 上で動く app
として扱います。

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

- **Space**: 所有と隔離の単位
- **Primitive (foundation, Layer 1)** — 1st-class エンティティ。それぞれ独立
  した lifecycle を持つ
  - **Compute** (Worker / Service / Attached): deployable workload
  - **Storage / Resource**: backing capability (sql / object-store / kv / queue / ...)
  - **Route**: hostname / path → compute のマッピング
  - **Publication**: 外部 interface の公開情報
- **Group (上位 bundling layer, Layer 2)**: 複数の primitive を束ねた bulk
  lifecycle unit。manifest deploy で自動作成される。user-facing には「app」と
  呼ぶ
- **Binding**: storage を compute に紐付ける名前付き接続 (env として inject)

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
- 開発中はローカル manifest の `takos deploy --plan` / `takos deploy` を使う
- canonical repository URL や catalog package からは `takos deploy URL` /
  `takos install` を使う

### space を運用したい人

- deploy dashboard から resources / deploys / installed apps を見る
- default apps を preinstall しつつ、必要なら uninstall / replace する

### operator

- space / repo / resource / route の関係を把握する
- rollback / provider 差分 / source provenance を確認する

### internal 実装者

- public contract と internal model の境界を確認してから code を追う

## 最初に読むページ

- Takos の product boundary は [アーキテクチャ](/architecture/) と
  [Kernel](/architecture/kernel)
- app の deploy/runtime contract は [アプリ構成](/apps/) と [デプロイ](/deploy/)
- CLI / API は [リファレンス](/reference/)

## 次に読むページ

- [はじめる](/get-started/)
- [アプリ構成](/apps/)
- [デプロイ](/deploy/)
