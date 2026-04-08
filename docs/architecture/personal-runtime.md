# Personal Runtime Proposal

::: warning Draft
このページは設計段階の Proposal です。実装は決定していません。
:::

## 概要

Takos の runtime を「1人用」 (personal) と「distribution」 (multi-tenant
SaaS) の 2 つに再設計する提案。

- **Personal runtime**: operator が自分用に走らせる単一テナント runtime。
  軽量で、複雑な multi-tenant 機能 (billing / quota / dispatch namespace 等)
  を持たない。home server / homelab で動かすのが想定 use case。
- **Distribution runtime**: 現状の Cloudflare Workers + Container DO ベース
  の multi-tenant runtime。複数 user の workspace を 1 つの kernel で管理。

## 動機

- 現状の kernel は production-grade multi-tenant runtime を前提とした
  resource model (billing / dispatch namespace / runtime tier 等) に
  なっており、個人 operator が自分のワークロード用に動かすには
  overhead が大きい。
- federation で他 instance と相互運用するなら、protocol の reach は
  共通 (ActivityPub) で良いが、deploy / runtime model は「家用」と
  「業務用」で分離した方が clean。

## 設計の方針 (TBD)

詳細は別途設計 doc に展開予定。以下は方向性のメモ:

1. Personal runtime は **single-binary** (Deno) で deploy。Cloudflare Workers
   依存無し。
2. Storage は SQLite + ローカル R2-互換 (MinIO 等) でも OK。Distribution
   runtime と同じ `PaymentProvider` / `RuntimeBucket` interface を share。
3. Auth は single-user mode (no OAuth client / no session management) で
   起動可能。distribution runtime と同じ kernel コードを再利用。
4. Federation は両 runtime 共通 (ActivityPub の wire protocol は同じ)。
5. Migration / upgrade flow は personal → distribution への昇格を想定
   (homelab で試して、規模が大きくなったら CF にリホスト)。

## 関連ドキュメント

- [Kernel](./kernel.md) — Takos の現状 architecture
- [Deploy System](./deploy-system.md) — 現状の resource / group モデル
- [Compatibility](./compatibility.md) — backend 互換性レイヤー
