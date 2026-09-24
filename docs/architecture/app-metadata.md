# アプリメタデータの境界

> このページでわかること: アプリ表示・配置に関わるメタデータを Takos と Takosumi の
> どちらが持つか。

Takos にアプリを 1 つ追加すると、そのアプリの実体は Takosumi が **Capsule** (Git URL から取り込むアプリ/イン
フラの 1 単位。[Takosumi の概念](https://takosumi.com/docs/concepts/) 参照) として記録し、install / plan / apply の実行記録
(**Capsule -> Run -> StateVersion -> Output**) を残します。provider の許可範囲、認証情報、state backend、
workload placement は **ProviderConnection / ProviderBinding / policy** が所有します。一方で、
アプリの宣言メタデータは Takosumi の service-side Interface が所有し、Takos はその認可済み view を launcher や
file handling として描画します。

## 実装済みの Runtime Interface

Takos は product として、ユーザーに見える workspace 体験を所有します。ただし Git / storage / agent runtime /
MCP を、OpenTofu Output の中に Takos 専用の service 種別として宣言させることはありません。deploy された
runtime の宣言は Takosumi の service-side `Interface` が正本 (正とする情報) で、利用者の認可は `InterfaceBinding`
が正本です。詳細は [Capsule の runtime Interface](./capsule-runtime-projection) を参照してください。

Capsule の OpenTofu module は、endpoint のような通常の deploy の事実だけを root Output として返せます。
Interface がその値を必要とする場合は、`capsule_output` という input の種類で、Capsule id / Output 名 / 任意
の JSON Pointer を明示します。Takos は、Resolved な Interface と同じ revision を観測する Ready な Binding
だけを、アプリランチャー、MCP registry、file handling、Git UX、storage UX、agent UX で解釈します。未知の
type / version は推測しません。

アプリ一覧に使う宣言は Takosumi が所有します。

- `interface.ui.surface` の URL、表示名、説明、アイコン、カテゴリ、順序
- `interface.file.handler` の open URL、MIME type、拡張子
- `mcp.server` の endpoint、delivery、non-secret document
- Interface の type / version、permission、resolved revision

表示メタデータの具体キー、icon の許可形式、URL の安全規則は managed Interface profile の契約詳細です。
type / version、inputs、permissions、revision checks、URL rules、display metadata は [OpenTofu Output とランタイム Interface](../deploy/runtime-interfaces.md) に
集約し、このページでは Takos の表示責任と service-side metadata の所有境界を説明します。

Takos が所有するのは、対応する type / version の描画・呼び出し方、safe URL validation、ユーザーの local な
open-with 選択、chat / agent / memory / Workspace に紐づく product state です。`/api/apps` は別の app metadata
store ではなく、認可済み UI Interface の read-only view です。

Interface の実体、Output mapping、binding、lifecycle は service-side の Takosumi が所有します。アプリの
repository は v2.1 [`/.well-known/takosumi.json`](../../.well-known/takosumi.json) の `interfaces[]` で、launcher
など app-owned な Interface の宣言案と Output mapping を提案できます。Takosumi は exact source snapshot を
レビューして DB-owned `InstallConfig.interfaceBlueprints` に compile し、成功した Apply 後に host-owned
Interface へ生成します。repository metadata は実行権限ではなく、`launch_url` Output だけで Interface
を推測する fallback もありません。Host-managed adapter や control MCP の宣言は、必要に応じて service-side
`InstallConfig.interfaceBlueprints` または明示的な Interface API に残ります。現行の Interface 契約では Resource owner や
`resource_output` input はなく、repository declaration を compile しても owner は Workspace または Capsule、mapping は
`literal` または `capsule_output` です。
InterfaceBinding と lifecycle はどの経路でも Takosumi が引き続き所有します。
`InstallConfig.outputAllowlist` は UI / install summary / 外部表示へ公開する通常の Output を選ぶ別の設定であり、
Interface の宣言ではありません。どの Interface 宣言経路でも binding(認可)はユーザー側に残ります。アプリは
通常の Capsule として記録され、ユーザーがアンインストールできます。
`takos-storage` / `takos-git` / `takos-computer` も同じ通常の installable Capsule であり、その agent tool を
Takos の静的な catalog には複製しません。

現在 Takos が consumer として実装している 3 profile の詳細は [OpenTofu Output とランタイム Interface](../deploy/runtime-interfaces.md) を
参照してください。ランチャー、サイドバー、ファイルハンドラーは Takosumi の Interface を直接読み、Takos 内の publication
cache や Output Sync を経由しません。

## Takosumi が記録すること

アプリの「実体」をどこに反映するかは、Takosumi の実行記録側の関心事です。

- どの OpenTofu module をどの Git URL / commit / tag / module path で install したか (Source / Capsule)
- plan / apply / destroy の Run (typed Run) と、適用後の StateVersion / Output
- ProviderConnection / ProviderBinding / policy に紐づく provider の許可範囲、state backend、実行境界

Takos の resource authority は `deploy/product-resources.json` です。Takosumi は
`deploy/opentofu/cloudflare` を通常の OpenTofu module として install / apply します。
直接接続した Cloudflare account に product runtime connections を写します。Cloudflare provider-gap bridge は既定で off のため、通常の production provider path では未対応 gap は解決されず、disposable E2E だけ reviewed mode を明示します。
手書きの `wrangler` / distribution pipeline は direct Cloudflare adapter の artifact の生成 であり、
別の resource authority ではありません。

アカウント側の policy (account / 課金 / OIDC / dashboard) は Takosumi Accounts plane が持ちます。

## 関連ページ

- [内部トラスト境界](./internal-trust-boundaries.md)
- [システムアーキテクチャ](./system-architecture.md)
- [Capsule の runtime Interface](./capsule-runtime-projection.md)
- [Takosumi concepts](https://takosumi.com/docs/concepts/)
- [Takosumi の概念](https://takosumi.com/docs/concepts/)
