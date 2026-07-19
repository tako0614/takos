# OpenTofu Output とランタイム Interface

Takos のアプリ repository は、ふつうの OpenTofu/Terraform module のままです。Takosumi はその module を Capsule
として実行し、成功した Run と StateVersion、通常の root Output を記録します。ランタイムの宣言は Takosumi の
service-side な `Interface` レコードであり、特別な Output schema や repository manifest ではありません。

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

Workspace オーナー、オペレーター、または install flow が、Takosumi の service-side 設定に Interface を作成します。
plain module 向けの recipe path は `InstallConfig.interfaceBlueprints` です。最初の成功した apply 後に blueprint を
一度 materialize し、明示的な `capsule_output` input にその Capsule id を入れます。`/v1/interfaces` の service-side
API から同じ record を明示的に作ることもできます。宣言には、その利用者が理解できる任意の protocol type /
version を使えます。`document` は任意の non-secret な JSON で、動的な値は明示的な input で接続します。

Form-backed Resource では、verified な Takoform Form Definition の `interfaces[]` descriptor が portable な宣言を
所有できます。descriptor は open な name / version、non-secret document schema、`literal` / Form output からの
deterministic input mapping だけを持ちます。Takosumi は Ready な Resource から普通の host-owned Interface を
materialize しますが、InterfaceBinding、token、認可、record lifecycle は Form や provider へ移しません。plain
Capsule に Form は必須ではなく、Takosumi 専用 provider resource を authoring path として要求しません。

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

- `literal`: Interface と一緒に保存された公開設定
- `capsule_output`: Capsule のふつうの root Output を名前で参照する
- `resource_output`: Resource が公開した観測済みの値を名前で参照する

Output を参照する input には、RFC 6901 の JSON Pointer も指定できます。Takosumi は input を
`status.resolvedInputs` に解決し、その来歴を記録し、実効値が変わるたびに解決済みリビジョンを進めます。module を
書き換えたり、固定の Output 名を要求したりはしません。

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

Takos が現在利用するのは、対応する Principal binding が `Ready` で、同じ Interface revision を観測しており、
`mcp.invoke` を許可し、認証情報なしの配送 (`none`) か、同梱の Principal `oauth2` フローのどちらかを使っている、
解決済みの `mcp.server` Interface だけです。OAuth を使うには、認証情報を含まない HTTPS の resource URI、
Accounts が支える短命な issuer、Interface のオーナーがそのホスト名を管理していることを示す新しい host proof が
必要です。Workload-token や Secret を使った配送は、host 側が対応する実装を提供するまで使えません。未対応の配送
方式は安全側に停止します。

認証情報の値は、Output、Interface document、解決済み input、Binding record のどこにも入りません。
ProviderConnection / CredentialRecipe / ProviderBinding は OpenTofu の Run を認可するためのもので、ランタイム
Interface の認可には転用しません。

## ソース検出

Takos は、次のふつうの module path から順に、install できる OpenTofu source を認識します。

- `main.tf`
- `outputs.tf`
- `takos.tf`
- `opentofu/main.tf`
- `opentofu/outputs.tf`
- `infra/main.tf`
- `infra/outputs.tf`
- `deploy/opentofu/main.tf`
- `deploy/opentofu/outputs.tf`

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
- [Takosumi Deploy-Control API](https://takosumi.com/docs/reference/deploy-control-api)
