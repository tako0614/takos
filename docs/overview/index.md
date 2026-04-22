# Takos 全体像

Takos は、AI エージェント時代のサービスとソフトウェアを動かすための infra kernel
です。プロダクト UI は kernel に埋め込むのではなく、Takos 上で動く group
として扱います。Store / UI では product label として app
と表示する場合があります。

このページは、`.takos/app.yml` / `.takos/app.yaml` や CLI
の詳細に入る前に、「Takos をどの単位で理解すればよいか」を揃える入口です。

## このページで依存してよい範囲

- Takos の全体像
- docs の読み順
- public 用語と internal 用語の大まかな対応

## このページで依存してはいけない範囲

- backend 固有の lower-level route
- internal table 名
- 個別 API / CLI / manifest の詳細契約

## Takos が扱う基本単位

- **Space**: 所有と隔離の単位
- **Primitive**: service / resource / route / publication / consume edge
  などの個別 record
- **Group**: primitive を任意に束ねる state scope。所属 primitive は inventory、
  snapshot、rollback、uninstall などの group 機能を使える
- **Workload** (Worker / Service / Attached): deployable unit。内部では
  `services` / `deployments` に保存される
- **Resource**: control-plane managed backing capability (sql / object-store /
  kv / queue / ...)。内部では `resources` に保存され、group 所属の有無で CRUD /
  binding の扱いは変わらない
- **Route**: hostname / path → workload のマッピング
- **Publication**: 外部 interface の公開情報
- **App**: Store / UI 上の product label。deploy model を説明するときは
  primitive / group を使う
- **Consume**: compute が必要な publication / built-in provider publication を宣言する接続
  (env は宣言した consumer にだけ inject)

## public と internal の読み分け

Takos Docs では、次の 3 層を分けて読みます。

1. public contract
2. implementation note
3. internal model

採用判断に使うのは `apps/` と `reference/` です。`architecture/` は、Takos
が内側でどう動いているかを理解するための章です。

## 代表的なユースケース

### primitive を配備したい人

- deploy manifest (`.takos/app.yml` / `.takos/app.yaml`) を書く
- workflow artifact を用意する
- 開発中はローカル manifest の `takos deploy --plan` / `takos deploy` を使う
- canonical repository URL や catalog package からは `takos deploy URL` /
  `takos install OWNER/REPO` を使う
- group なし primitive は個別 primitive API / CLI で管理する

### space を運用したい人

- deploy dashboard から resources / deploys / installed groups を見る
- default app distribution の product root と installed groups を見分けて
  install / uninstall / replace する

### operator

- space / repo / resource / route の関係を把握する
- rollback / runtime execution context / source provenance を確認する

### internal 実装者

- public contract と internal model の境界を確認してから code を追う

## 最初に読むページ

- Takos の product boundary は [アーキテクチャ](/architecture/) と
  [Kernel](/architecture/kernel)
- primitive の deploy/runtime contract は [Deploy 構成](/apps/) と
  [デプロイ](/deploy/)
- CLI / API は [リファレンス](/reference/)

## 次に読むページ

- [はじめる](/get-started/)
- [Deploy 構成](/apps/)
- [デプロイ](/deploy/)
