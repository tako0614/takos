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

外部ワークロードは **primitive-first deploy model**:

- **primitive**: service / deployment / route / publication / resource / consume
  edge などの個別 record
- **group**: primitive を任意に束ねる state scope。所属 primitive は inventory、
  snapshot、rollback、uninstall などの group 機能を使える
- **manifest**: primitive desired declaration の入力。group 専用形式ではない
- **resource**: SQL / object-store / queue などの backing capability。group
  所属の有無で resource CRUD / runtime binding の扱いは変わらない

## Internal model

- control plane: kernel の実装（API, DB, deploy pipeline, routing）
- tenant runtime: group の実行面（dispatch, worker, container）

## Backend

- Cloudflare: 主要 production backend
- local: 検証用 backend
- backend / adapter で backend 差分を閉じ込める。backend 名は operator-only
  configuration で、public deploy manifest には書かない

## 詳細ページ

- [Kernel](./kernel.md) — Takos の定義、routing、publication
- [Deploy System](./deploy-system.md) — primitive と group 機能の deploy
  pipeline
- [Publication / Consume](./app-publications.md) — publication の仕組みと env
  injection
- [Control Plane](./control-plane.md) — API, DB, routing layer
- [Tenant Runtime](./tenant-runtime.md) — dispatch, worker execution, container
- [互換性と制限](./compatibility.md) — backend parity
