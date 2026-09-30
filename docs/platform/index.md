# Takos の概念

Takos は、OpenTofu ネイティブな AI Workspace distribution です。利用者が触れる
chat、エージェント、メモリ、Workspace、アプリランチャーを Takos が持ち、その背後の
実行・記録は外部の Takosumi 管理プレーンが持ちます。

## どこに境界があるか

| ソフトウェア | 持つもの |
| --- | --- |
| Takos | chat、agent、memory、Workspace、app launcher、file handler、UI surface、MCP 接続 |
| Takosumi | Workspace / Capsule / Source / ProviderConnection / ProviderBinding / Run / StateVersion / Output の authority、Accounts plane（OIDC・課金・ダッシュボード） |

アプリや実行基盤は Capsule の Output と Takos runtime contract を通じて見えます。
Takos 自身は deployment authority を持たず、アプリの install やインフラの変更は
Takosumi の deploy control plane または Accounts plane の install flow を呼びます。

## どう動くか

1. `deploy/product-resources.json` が Takos の論理トポロジーを宣言し、
   `deploy/opentofu/cloudflare` が現在の product-graph adapter として具体リソースへ写像する。
2. Takosumi がその module を普通の OpenTofu Capsule として install し、
   `plan` type Run → `apply` type Run → StateVersion / Output として記録する。
3. Workspace が作られ、利用者は Capsule アプリを plan / apply の Run を通じて
   明示的に追加する。

## 次に読む

- [Space](/platform/spaces) — Workspace の中身
- [Threads and Runs](/platform/threads-and-runs) — 依頼が実行になるまで
- [Git URL から install](/platform/store) — アプリの追加方法
- [Bundled Apps](/platform/featured-apps) — first-party の Capsule アプリ
- [セルフホスト概要](/deploy/) — operator として動かす場合
