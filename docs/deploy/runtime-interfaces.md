# OpenTofu Output とランタイム Interface

Takos のアプリ repository は、ふつうの OpenTofu/Terraform module のままです。Takosumi はその module を Capsule
として実行し、成功した Run と StateVersion、通常の root Output を記録します。ランタイムの実体と認可は
Takosumi の service-side な `Interface` / `InterfaceBinding` レコードが所有します。app-owned launcher などの
宣言案は repository manifest v2 から compile できますが、manifest は実行権限ではありません。

## 通常の OpenTofu Output

アプリは、そのオペレーターや明示的に設定された利用者にとって役立つ、デプロイの事実を返せます。名前と値の形は
module 側が決めます。

```hcl
output "mcp_url" {
  description = "Public Streamable HTTP endpoint for this deployment"
  value       = "${cloudflare_worker_deployment.app.url}/mcp"
}

output "launch_url" {
  value = cloudflare_worker_deployment.app.url
}
```

Takosumi は `tofu output -json` を通じてこれらの値を取得します。通常の OpenTofu の sensitive metadata はそのまま
保たれ、どの Output 名もランタイムの登録簿として特別扱いしません。sensitive な Output はふつうの OpenTofu として
有効ですが、公開の Interface input としては解決できません。

`InstallConfig.outputAllowlist` は、通常の root Output のうち UI、install summary、外部表示に公開する名前と型を
service-side で明示します。これは Interface の宣言ではなく、Output 名から Interface や lifecycle action を推測する
仕組みでもありません。

## Takosumi で Interface を宣言する

Interface の `ownerRef.kind` は現行契約では `Workspace` または `Capsule` だけです。Workspace オーナー、オペレーター、
または install flow が service-side 設定に Interface を作成します。app-owned launcher のような plain Capsule の宣言案は、
repository の v2 `interfaces[]` から exact snapshot と module compatibility をレビューしたうえで
`InstallConfig.interfaceBlueprints` に compile できます。保存される Interface は Capsule-owned または Workspace-owned です。
成功した apply 後に blueprint を生成し、動的な値は明示的な `literal` または `capsule_output` input で接続します。
`launch_url` のような Output は宣言された Interface input の値にすぎず、Output 名から Interface を推測する fallback は
ありません。`/api/v1/interfaces` の service-side API から同じ record を明示的に作ることもできます。`document` は任意の
non-secret な JSON で、type / version は利用者が理解できる契約を選びます。Resource-owned Interface と
`resource_output` input は現行の Interface 契約にはありません。

`InstallConfig.lifecycleActions` は同じく service-side の設定ですが、provider gap や application initialization のための
Plan-pinned action であり、Interface や Output から生成しません。

```json
{
  "workspaceId": "ws_1",
  "name": "researchTools",
  "ownerRef": { "kind": "Capsule", "id": "cap_1" },
  "spec": {
    "type": "mcp.server",
    "version": "2025-11-25",
    "document": {
      "transport": "streamable-http",
      "display": { "title": "Research tools" }
    },
    "inputs": {
      "endpoint": {
        "source": "capsule_output",
        "capsuleId": "cap_1",
        "outputName": "mcp_url"
      }
    },
    "access": {
      "visibility": "workspace",
      "resourceUriInput": "endpoint"
    }
  }
}
```

input に使える source は次のとおりです。

- `literal`: Interface と一緒に保存された non-secret な公開設定
- `capsule_output`: Capsule のふつうの root Output を名前で参照する

Output を参照する input には、RFC 6901 の JSON Pointer も指定できます。Takosumi は input を
`status.resolvedInputs` に解決し、その来歴を記録し、実効値が変わるたびに解決済みリビジョンを進めます。module を
書き換えたり、固定の Output 名を要求したりはしません。

## Takos の managed Interface profiles

Takos が現在読む managed Interface は次の 3 profile です。各 profile は exact な Interface の type / version、
宣言された input と `status.resolvedInputs`、対応する permission、delivery を検証します。

| 対象 | type / version | 必須の宣言と解決済み input | permission / delivery |
| --- | --- | --- | --- |
| MCP tool | `mcp.server` / `2025-11-25` | `inputs.endpoint`、`status.resolvedInputs.endpoint`、`document.transport = streamable-http` | `mcp.invoke`; `none` または実装済みの Principal `oauth2` |
| アプリランチャーとサイドバー | `interface.ui.surface` / `1` | `inputs.url`、`status.resolvedInputs.url`、`document.launcher = true`、任意の `document.display` / `document.sidebar` | `ui.open`; `none` |
| ファイルを開くハンドラー | `interface.file.handler` / `1` | `inputs.openUrl`、`status.resolvedInputs.openUrl`、有効な `document.mimeTypes` または `document.extensions` を 1 つ以上 | `file.open`; `none` |

すべての profile は、Interface の `metadata.generation` と `status.observedGeneration` が一致する `Resolved` 状態、
正の `status.resolvedRevision`、その revision を `observedInterfaceRevision` として持つ現在の Principal の `Ready` な
InterfaceBinding を要求します。未知の type / version、未宣言または未解決の input、古い binding、未対応の delivery は
安全側に停止します。

`document.display` の正規キーは `title` / `description` / `icon` / `category` / `sortOrder`（すべて任意）です。
`interface.ui.surface` は `document.launcher = true` と任意の `document.sidebar` を持ちます。`display.icon` は、
credential 情報を含まない絶対 HTTPS URL、surface の解決済み runtime URL の origin 基準で解決する先頭 `/` パス、
または `/` `.` `:` を含まない 16 文字以内の emoji glyph のいずれかです。

profile の runtime URL は HTTP(S) で、userinfo、fragment、認証情報らしき query parameter を含みません。ファイル
ハンドラーの URL はさらにリテラルの `:id` パスセグメントを 1 つ含み、Takos が選択した file ID に置き換えます。
UI とファイルハンドラーは独自の credential 配信を要求できません。

## 利用者を認可する

発見 (discovery) と認可 (authority) は別です。`InterfaceBinding` が、その Interface を利用できる主体・権限・
配送方式を名指しで決めます。

```json
{
  "subjectRef": { "kind": "Principal", "id": "account_1" },
  "permissions": ["mcp.invoke"],
  "delivery": { "type": "none" }
}
```

上記の profile を利用するには、対応する Principal binding が `Ready` で、同じ Interface revision を観測している必要が
あります。OAuth を使う場合は、認証情報を含まない HTTPS の resource URI、Accounts が支える短命な issuer、
Interface のオーナーがそのホスト名を管理していることを示す host proof が必要です。Workload-token や Secret を使う
delivery は host 側が対応する実装を提供するまで `NotReady` のままです。

認証情報の値は、Output、Interface document、解決済み input、Binding record のどこにも入りません。
ProviderConnection / CredentialRecipe / ProviderBinding は OpenTofu の Run を認可するためのもので、runtime Interface の
認可には転用しません。

## ソース検出

Takos は、次のふつうの module path から順に、install できる OpenTofu source を認識します。

- `main.tf`
- `outputs.tf`
- `takos.tf`
- `opentofu/main.tf`
- `opentofu/outputs.tf`
- `infra/main.tf`
- `infra/outputs.tf`
- `deploy/opentofu/cloudflare/main.tf`
- `deploy/opentofu/cloudflare/outputs.tf`

source の検出は module を特定するだけです。HCL の内容や、よく使われる Output 名からランタイムのサービスを推測
したりはしません。

## 境界

- OpenTofu が持つのは、リソース、state、変数、root Output です。
- Takosumi が持つのは、Capsule の実行、永続的な Output の取得、Interface の input 解決、InterfaceBinding の認可、
  ポリシー、監査です。
- Takos が使うのは、自分が実装している Interface の type / version だけで、launcher、MCP、file-handler、agent の
  ユーザー体験を持ちます。
- 明示的な Capsule Dependency や `terraform_remote_state` は OpenTofu 同士の input 配線のためのもので、ランタイム
  の認可ではありません。

## 関連ページ

- [デプロイ概要](/deploy/)
- [インストール経路](/apps/install-paths)
- [Takos App Interface](/architecture/app-interface)
- [Capsule Runtime Interfaces](/architecture/capsule-runtime-projection)
- [Takosumi API](https://takosumi.com/docs/reference/api)
