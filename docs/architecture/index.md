# アーキテクチャ

Takos は AI によるソフトウェア民主化基盤。

## Takos の定義

AI agent がソフトウェアを作り・管理し・配布するための統合基盤。

kernel が提供するもの:

- **Agent / Chat**（AI の中核体験）
- **Git**（コード管理）
- **Storage**（ファイル管理）
- **Store**（配布 / カタログ）
- **Auth / Deploy / Routing / Resources / Billing**

外部ワークロードは **二層モデル**:

- **primitive (foundation)**: compute / resource / route / publish。1st-class
  エンティティで、それぞれ独立した lifecycle を持つ。public manifest では
  `storage:` ではなく `publish` / `consume` を使う
- **group (上位 bundling layer)**: 複数の primitive を束ねて bulk lifecycle と
  desired state management を提供する optional な仕組み。user-facing には
  「app」と呼ぶ

## Internal model

- control plane: kernel の実装（API, DB, deploy pipeline, routing）
- tenant runtime: group の実行面（dispatch, worker, container）

## Backend

- Cloudflare: 主要 production backend
- local: 検証用 backend
- provider / adapter で backend 差分を閉じ込める

## 詳細ページ

- [Kernel](./kernel.md) — Takos の定義、routing、publication
- [Personal Runtime Proposal](./personal-runtime.md) — 1人用 runtime +
  distribution service への再設計案
- [Deploy System](./deploy-system.md) — primitive (Layer 1) と group (Layer 2)
  の二層モデル、deploy pipeline
- [App Publications](./app-publications.md) — publication の仕組みと env
  injection
- [Control Plane](./control-plane.md) — API, DB, routing layer
- [Tenant Runtime](./tenant-runtime.md) — dispatch, worker execution, container
- [互換性と制限](./compatibility.md) — backend parity
- [実装計画](./implementation-plan.md) — 移行計画
