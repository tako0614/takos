# 実装計画

## 現状

apps/control (monolith) に全機能が統合済み。
Agent, Git, Storage, Store, Auth, Dashboard, Deploy, Routing — 全て kernel の一部として動作している。

## 目標

kernel はそのまま維持。
外部 group を deploy できる基盤を構築する。

## Phase

### Phase 0: Group deploy 基盤

- routing layer: RoutingRecord で group に hostname を割り当て
- publication env injection: group 間の URL 解決
- app token: group 用の JWT 発行
- manifest parser: .takos/app.yml の parse と desired state 生成

### Phase 1: Default group の deploy

- takos-computer, takos-docs, takos-excel, takos-slide を deploy
- 各 group が独自 hostname + D1/R2 で動作確認
- kernel の sidebar から UiSurface を iframe で表示

### Phase 2: Store 連携

- Store から third-party group を install できるようにする
- takos install コマンドの実装
- catalog → manifest fetch → group create → deploy

## 変更しないもの

- Agent / Chat: kernel に統合済み。変更なし
- Git: kernel に統合済み。変更なし
- Storage: kernel に統合済み。変更なし
- Store: kernel に統合済み。変更なし（group deploy の catalog 機能を追加するのみ）
