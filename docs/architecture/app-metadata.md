# アプリメタデータの境界

> このページでわかること: アプリ表示・配置に関わるメタデータを Takos と Takosumi の
> どちらが持つか。

Takos にアプリを 1 つ追加すると、そのアプリの実体は Takosumi が **Capsule** (Git URL から取り込むアプリ/イン
フラの 1 単位。[Takosumi のモデル](https://takosumi.com/docs/reference/model) 参照) として記録し、install / plan / apply の実行記録
(**Capsule -> Run -> StateVersion -> Output**) を残します。provider の許可範囲、認証情報、state backend、
Cloudflare Container の実行は **ProviderConnection / ProviderBinding / policy** が所有します。一方で、
アプリの宣言メタデータは Takosumi の service-side Interface が所有し、Takos はその認可済み view を launcher や
file handling として描画します。

## 実装済みの Runtime Interface

Takos は product として、ユーザーに見える workspace 体験を所有します。ただし Git / storage / agent runtime /
MCP を、OpenTofu Output の中に Takos 専用の service 種別として宣言させることはありません。deploy された
runtime の宣言は Takosumi の service-side `Interface` が正本 (管理元) で、利用者の認可は `InterfaceBinding`
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

表示メタデータの具体キーは Takosumi の正本 spec (final-plan / core-spec の
Display Metadata Contract) に一元定義された `document.display` object です:
`title` / `description` / `icon` / `category` / `sortOrder`(すべて任意)。
`interface.ui.surface` はさらに `document.launcher = true`(ランチャー表示)と
任意の `document.sidebar` を持ちます。`display.icon` に使えるのは次の 3 形式
だけです。

- credential 情報を含まない絶対 HTTPS URL
- 先頭 `/` のパス(surface の解決済み runtime URL の origin 基準で解決。例:
  `resolvedInputs.url` が `https://app.example` のとき `/icons/app.svg` →
  `https://app.example/icons/app.svg`)
- 短い emoji glyph(16 文字以内、`/` `.` `:` を含まない)

この parse / sanitize は contract 層が export する共有 parser を使うのが正で、
consumer ごとの独自実装は conformance 違反です。

Takos が所有するのは、対応する type / version の描画・呼び出し方、safe URL validation、ユーザーの local な
open-with 選択、chat / agent / memory / Workspace に紐づく product state です。`/api/apps` は別の app metadata
store ではなく、認可済み UI Interface の read-only view です。

Interface の宣言と Output mapping は service-side の設定として管理し、アプリのリポジトリには Takosumi 専用の
manifest を要求しません。宣言源の正本は Takosumi final-plan の Interface Declaration Sources で、service-side
`InstallConfig.interfaceBlueprints` に加えて、module が任意で `takosumi_interface` リソース(optional
`takosumi/takosumi` provider)を使って自分の Interface を宣言する経路が定義されています。
`InstallConfig.outputAllowlist` は UI / install summary / 外部表示へ公開する通常の Output を選ぶ別の設定であり、
Interface の宣言ではありません。どちらの Interface 宣言経路でも binding(認可)はユーザー側に残ります。アプリは
通常の Capsule として記録され、ユーザーがアンインストールできます。
`takos-storage` / `takos-git` / `takos-computer` も同じ通常の installable Capsule であり、その agent tool を
Takos の静的な catalog には複製しません。

現在 Takos が consumer として実装している profile は次の 3 つです。

- MCP: `mcp.server` version `2025-11-25`、`inputs.endpoint`、`mcp.invoke`
- ランチャー / サイドバー: `interface.ui.surface` version `1`、`inputs.url`、`document.launcher = true`、
  `ui.open`
- ファイルハンドラー: `interface.file.handler` version `1`、`inputs.openUrl`、MIME type / 拡張子のセレクタ、
  `file.open`

いずれも、Resolved な Interface と同じ revision の Ready な Principal Binding を要求し、未知の type /
version、未宣言の input、古い Binding、未対応の delivery は安全側に停止し、表示しません。ランチャー /
サイドバー / ファイルハンドラーは Takosumi の Interface を直接読み、Takos 内の publication cache や Output
Sync を経由しません。

## Takosumi が記録すること

アプリの「実体」をどこに反映するかは、Takosumi の実行記録側の関心事です。

- どの OpenTofu module をどの Git URL / commit / tag / module path で install したか (Source / Capsule)
- plan / apply / destroy の Run (typed Run) と、適用後の StateVersion / Output
- ProviderConnection / ProviderBinding / policy に紐づく provider の許可範囲、state backend、実行境界

Takos の deploy topology 自体も、`deploy/opentofu` の OpenTofu module (`var.target = cloudflare`) として
Takosumi が install / apply します。`cloudflare` target では、土台となるリソース (D1 / KV / R2 / Queues) を
作成します。手書きの `wrangler` / distribute pipeline は、この同じ topology を暫定的に反映する手段 (interim
materialization) であり、別の正とする情報ではありません。

アカウント側の policy (account / 課金 / OIDC / dashboard) は Takosumi Accounts plane が持ちます。

## 関連ページ

- [内部トラスト境界](./internal-trust-boundaries.md)
- [システムアーキテクチャ](./system-architecture.md)
- [Capsule の runtime Interface](./capsule-runtime-projection.md)
- [Takosumi specification](https://takosumi.com/docs/reference/model)
- [Takosumi のモデル](https://takosumi.com/docs/reference/model)
