# アーキテクチャ

Takos は一人用の AI ワークスペースです。一つの OIDC identity を app-local
Principal へ写し、その人が用途別の private Workspace を複数作れます。Chat、agent、
Memory、app-local Workspace は standalone で動作します。デプロイ管理を内蔵せず、
external identity、canonical Capsule lifecycle、Interface が必要な構成だけ外部
Takosumi を利用します。

## 全体の流れ

```text
ブラウザ
  ↓
Takos Worker ── Files / Git / Memory
  │
  ├─ エージェント実行サービス
  └─ アプリや MCP サーバーのツール

Takosumi（optional integration）
  └─ external identity、委任された Capsule の OpenTofu 実行、実行履歴、Interface
```

Takos Worker は API とブラウザ UI の入口です。一つの host が複数 Principal を収容する場合もデータを分離し、Workspace は Principal 間で共有しません。エージェント実行サービスは、実行ごとに許可された操作だけを受け取ります。アプリや外部 MCP サーバーのツールは、Workspace の境界を確認してから公開されます。

## クラウドとの境界

Takos本体が必要とするリソースと接続名の正本 (正とする情報)は
[`deploy/product-resources.json`](https://github.com/tako0614/takos/blob/main/deploy/product-resources.json)です。
そこにはCloudflare、Takoform、account ID、credentialを書きません。

- `deploy/opentofu/cloudflare` は、自分のCloudflare accountへ直接置くadapterです。
- `deploy/opentofu/takoform` は、同じ論理リソースをTakoform対応hostへ置く既定adapterです。
- Takosumiはどちらも普通のOpenTofu moduleとして扱います。Takos専用providerや
  特別なapply経路はありません。Takosumi経由の場合はそのRun/state/output ledger
  がcanonical authorityです。

Cloudflare Workers用entrypointやCloudflare binding変換はCloudflare adapterに残ります。
API、agent、tool、storageなどの製品ロジックは中立bindingを使い、選んだadapterを知りません。

## 読む順番

1. [システム全体](/architecture/system-architecture) — サービスと所有者
2. [エージェント実行](/architecture/runtime-service) — 一つの依頼が完了するまで
3. [アプリの公開情報](/architecture/app-interface) — Apps、MCP、file handler の表示方法
4. [信頼境界](/architecture/internal-trust-boundaries) — サービス間の認証と権限

## 詳細ページ

| ページ                                                   | 内容                            |
| -------------------------------------------------------- | ------------------------------- |
| [システム全体](/architecture/system-architecture)        | Takos と Takosumi の境界        |
| [サービス構成](/architecture/service-topology)           | ローカル環境のサービスとポート  |
| [エージェント実行](/architecture/runtime-service)        | 実行、ツール、メモリ            |
| [アプリの公開情報](/architecture/app-interface)          | UI、MCP、ファイル形式           |
| [実行時の接続](/architecture/capsule-runtime-projection) | デプロイ結果から接続を作る方法  |
| [アプリメタデータ](/architecture/app-metadata)           | 名前、URL、機能の所有者         |
| [信頼境界](/architecture/internal-trust-boundaries)      | 内部呼び出しと capability token |
| [構成図](/architecture/diagrams)                         | 主な処理の図                    |

## 用語について

この章では、API と実装に対応させるため Takosumi 固有の名前も使います。初めて出てくる用語は [用語集](/reference/glossary) で確認できます。利用者向けページでは、可能な限り「アプリ」「実行」「公開先」のような一般的な言葉を使います。
